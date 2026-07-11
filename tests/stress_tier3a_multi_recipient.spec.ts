/**
 * Tier3A — Multi-Recipient Pay Storm (STRICT)
 *
 * Focus:
 * - Many recipients
 * - Bounded concurrency
 * - Treasury conservation invariant
 * - Recipient aggregate invariant
 *
 * Canonical model:
 * - payCount-based splPay receipts
 * - explicit setup + explicit deposit
 * - finalized transport
 * - recipient ATAs precreated
 * - PAY serialized (payCount receipt safety)
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";

import {
  loadProtocolAuthority,
  initFoundationOnce,
  setupMintAndAtas,
  airdrop,
  expect,
  getTreasuryPayCount,
  derivePayReceiptPda,
} from "./_helpers";

/* -----------------------------
 * tiny utils
 * ----------------------------- */

const bn = (x: number | string | bigint) => new anchor.BN(x.toString());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runBounded<T>(
  limit: number,
  items: T[],
  worker: (item: T, idx: number) => Promise<void>
) {
  const queue = items.map((item, idx) => ({ item, idx }));
  const running: Promise<void>[] = [];

  async function spawn() {
    const next = queue.shift();
    if (!next) return;
    await worker(next.item, next.idx);
    await spawn();
  }

  for (let i = 0; i < limit; i++) running.push(spawn());
  await Promise.all(running);
}

function createMutex() {
  let chain = Promise.resolve();
  return async function lock<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(fn, fn);
    chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };
}

function getIx(program: Program<any>, name: string): any {
  const ix = (program.idl.instructions as any[]).find((i) => i.name === name);
  if (!ix) throw new Error(`IDL instruction not found: ${name}`);
  return ix;
}

function accMetaFromIdl(acc: any) {
  const isSigner = !!acc.isSigner;
  const isWritable = !!acc.isMut || !!acc.isWritable || !!acc.writable || false;
  return { isSigner, isWritable };
}

/* -----------------------------
 * transport
 * ----------------------------- */

async function sendRawTxFresh(args: {
  provider: AnchorProvider;
  tx: Transaction;
  signers: Keypair[];
  commitment?: anchor.web3.Commitment;
}): Promise<string> {
  const {
    provider,
    tx,
    signers,
    commitment = "finalized",
  } = args;

  const feePayer = signers[0]?.publicKey ?? (provider.wallet as any).publicKey;
  tx.feePayer = feePayer;

  const latest = await provider.connection.getLatestBlockhash("finalized");
  tx.recentBlockhash = latest.blockhash;
  tx.sign(...signers);

  const sig = await provider.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "finalized",
    maxRetries: 3,
  });

  await provider.connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    commitment
  );

  return sig;
}

/* -----------------------------
 * ATA helper
 * ----------------------------- */

async function ensureAtaExists(args: {
  provider: AnchorProvider;
  payer: Keypair;
  owner: PublicKey;
  mint: PublicKey;
}): Promise<PublicKey> {
  const { provider, payer, owner, mint } = args;

  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const existing = await provider.connection.getAccountInfo(ata, "finalized");
  if (existing) return ata;

  const ix = createAssociatedTokenAccountInstruction(
    payer.publicKey,
    ata,
    owner,
    mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  await sendRawTxFresh({
    provider,
    tx: new Transaction().add(ix),
    signers: [payer],
    commitment: "finalized",
  });

  return ata;
}

/* -----------------------------
 * strict builders
 * ----------------------------- */

async function buildSplDepositTx(args: {
  program: Program<any>;
  user: Keypair;
  treasuryPda: PublicKey;
  mint: PublicKey;
  userAta: PublicKey;
  treasuryAta: PublicKey;
  amount: bigint;
}): Promise<Transaction> {
  const { program, user, treasuryPda, mint, userAta, treasuryAta, amount } = args;

  const ixDef = getIx(program, "splDeposit");

  const full: Record<string, PublicKey> = {
    user: user.publicKey,
    treasury: treasuryPda,
    mint,
    userAta,
    treasuryAta,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  };

  const argsObj: any = {};
  for (const a of ixDef.args as any[]) {
    const lower = String(a.name).toLowerCase();
    if (lower === "amount") argsObj[a.name] = bn(amount);
    else argsObj[a.name] = null;
  }

  const data = program.coder.instruction.encode("splDeposit", argsObj);

  const keys = (ixDef.accounts as any[]).map((acc: any) => {
    const pubkey = full[acc.name];
    if (!pubkey) {
      throw new Error(
        `Missing account '${acc.name}' for splDeposit. Provided: ${Object.keys(full).join(", ")}`
      );
    }
    const { isSigner, isWritable } = accMetaFromIdl(acc);
    return { pubkey, isSigner, isWritable };
  });

  return new Transaction().add(
    new TransactionInstruction({
      programId: program.programId,
      keys,
      data,
    })
  );
}

async function buildSplPayTx(args: {
  program: Program<any>;
  authority: Keypair;
  treasuryPda: PublicKey;
  treasuryAta: PublicKey;
  mint: PublicKey;
  recipient: PublicKey;
  recipientAta: PublicKey;
  receipt: PublicKey;
  amount: number;
}): Promise<Transaction> {
  const {
    program,
    authority,
    treasuryPda,
    treasuryAta,
    mint,
    recipient,
    recipientAta,
    receipt,
    amount,
  } = args;

  const ixDef = getIx(program, "splPay");

  const full: Record<string, PublicKey> = {
    treasuryAuthority: authority.publicKey,
    recipient,
    treasury: treasuryPda,
    mint,
    recipientAta,
    treasuryAta,
    receipt,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  };

  const argsObj: any = {};
  for (const a of ixDef.args as any[]) {
    const lower = String(a.name).toLowerCase();
    if (lower === "amount") argsObj[a.name] = bn(amount);
    else if (lower.includes("memo")) argsObj[a.name] = null;
    else if (lower.includes("reference")) argsObj[a.name] = null;
    else if (lower.includes("nonce")) {
      throw new Error("Tier3A expects canonical payCount-mode splPay, not nonce-mode.");
    } else {
      argsObj[a.name] = null;
    }
  }

  const data = program.coder.instruction.encode("splPay", argsObj);

  const keys = (ixDef.accounts as any[]).map((acc: any) => {
    const pubkey = full[acc.name];
    if (!pubkey) {
      throw new Error(
        `Missing account '${acc.name}' for splPay. Provided: ${Object.keys(full).join(", ")}`
      );
    }
    const { isSigner, isWritable } = accMetaFromIdl(acc);
    return { pubkey, isSigner, isWritable };
  });

  return new Transaction().add(
    new TransactionInstruction({
      programId: program.programId,
      keys,
      data,
    })
  );
}

/* -----------------------------
 * spec
 * ----------------------------- */

describe("stress - Tier3A multi-recipient pay storm", function () {
  this.timeout(5_400_000);

  const protocolAuth = loadProtocolAuthority();

  const envProvider = AnchorProvider.env();
  const provider = new AnchorProvider(
    envProvider.connection,
    new anchor.Wallet(protocolAuth),
    {
      commitment: "finalized",
      preflightCommitment: "finalized",
      skipPreflight: false,
    }
  );

  anchor.setProvider(provider);

  let program: Program<any>;
  let treasuryPda: PublicKey;
  let treasuryAta: PublicKey;
  let mint: PublicKey;
  let userAta: PublicKey;

  const RECIPIENTS = 20;
  const PAY_COUNT = 200;
  const CONCURRENCY = 10;

  const recipients: Keypair[] = [];
  const recipientAtas: PublicKey[] = [];

  const payLock = createMutex();

  before(async () => {
    // @ts-ignore
    const wsProgram = anchor.workspace.Protocol as Program<any>;
    const ctorArity = (Program as any).length;

    if (ctorArity >= 3) {
      program = new (Program as any)(wsProgram.idl, wsProgram.programId, provider);
    } else {
      const idl = wsProgram.idl as any;
      idl.metadata = {
        ...(idl.metadata ?? {}),
        address: wsProgram.programId.toBase58(),
      };
      program = new (Program as any)(idl, provider);
    }

    await airdrop(provider, protocolAuth.publicKey, 2, "finalized");

    const foundation = await initFoundationOnce(provider, program);
    treasuryPda = foundation.treasuryPda;

    const setup = await setupMintAndAtas(
      provider,
      protocolAuth,
      treasuryPda,
      1_000_000n
    );

    mint = setup.mint;
    userAta = setup.userAta;
    treasuryAta = setup.treasuryAta;

    const depositTx = await buildSplDepositTx({
      program,
      user: protocolAuth,
      treasuryPda,
      mint,
      userAta,
      treasuryAta,
      amount: 500_000n,
    });

    await sendRawTxFresh({
      provider,
      tx: depositTx,
      signers: [protocolAuth],
      commitment: "finalized",
    });

    recipients.length = 0;
    recipientAtas.length = 0;

    for (let i = 0; i < RECIPIENTS; i++) {
      const kp = Keypair.generate();
      recipients.push(kp);

      await airdrop(provider, kp.publicKey, 1, "finalized");
      const ata = await ensureAtaExists({
        provider,
        payer: protocolAuth,
        owner: kp.publicKey,
        mint,
      });

      recipientAtas.push(ata);
    }
  });

  it("distributes under load without value drift", async () => {
    const treasuryBefore = await getAccount(
      provider.connection,
      treasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );

    const recipientBefore: number[] = [];
    for (const ata of recipientAtas) {
      const acc = await getAccount(
        provider.connection,
        ata,
        "finalized",
        TOKEN_PROGRAM_ID
      );
      recipientBefore.push(Number(acc.amount));
    }

    let successPays = 0;

    await runBounded(CONCURRENCY, Array.from({ length: PAY_COUNT }), async (_, idx) => {
      await payLock(async () => {
        const targetIndex = idx % RECIPIENTS;

        const payCountBefore = bn(
  (await getTreasuryPayCount(program, treasuryPda)).toString()
);

        const [receipt] = derivePayReceiptPda(
          program.programId,
          treasuryPda,
          payCountBefore
        );

        const receiptInfo = await provider.connection.getAccountInfo(receipt, "finalized");
        if (receiptInfo) return;

        const tx = await buildSplPayTx({
          program,
          authority: protocolAuth,
          treasuryPda,
          treasuryAta,
          mint,
          recipient: recipients[targetIndex].publicKey,
          recipientAta: recipientAtas[targetIndex],
          receipt,
          amount: 1,
        });

        await sendRawTxFresh({
          provider,
          tx,
          signers: [protocolAuth],
          commitment: "finalized",
        });

        successPays++;
      });
    });

    const treasuryAfter = await getAccount(
      provider.connection,
      treasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );

    const treasuryDelta =
      Number(treasuryBefore.amount) - Number(treasuryAfter.amount);

    expect(treasuryDelta).to.eq(successPays);

    let recipientDeltaSum = 0;
    for (let i = 0; i < recipientAtas.length; i++) {
      const after = await getAccount(
        provider.connection,
        recipientAtas[i],
        "finalized",
        TOKEN_PROGRAM_ID
      );
      recipientDeltaSum += Number(after.amount) - recipientBefore[i];
    }

    expect(recipientDeltaSum).to.eq(successPays);
  });
});


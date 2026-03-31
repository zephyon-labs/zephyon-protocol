import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { expect } from "chai";
import { Protocol } from "../target/types/protocol";

import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";

import {
  initFoundationOnce,
  setupMintAndAtas,
  loadProtocolAuthority,
  airdrop,
  DIR_PAY,
  ASSET_SPL,
} from "./_helpers";

const DEBUG = process.env.DEBUG_TESTS === "1";

const V2_FLAG_HAS_REFERENCE = 1 << 0;
const V2_FLAG_HAS_MEMO = 1 << 1;

function bn(x: number | string | bigint) {
  return new anchor.BN(x.toString());
}

function toNum(v: any): number {
  if (v instanceof anchor.BN) return v.toNumber();
  return Number(v);
}

async function expectFail(p: Promise<any>) {
  let failed = false;
  try {
    await p;
  } catch {
    failed = true;
  }
  expect(failed).to.eq(true);
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

  const statusResp = await provider.connection.getSignatureStatuses([sig]);
  const status = statusResp.value[0];

  if (!status) {
    throw new Error(`sendRawTxFresh: missing signature status for ${sig}`);
  }

  if (status.err) {
    throw new Error(
      `sendRawTxFresh: transaction failed: ${JSON.stringify(status.err)}`
    );
  }

  return sig;
}

/**
 * Canonical receipt PDA:
 * seeds = ["receipt", treasury, pay_count_before (LE u64)]
 */
function receiptPdaPayCount(
  programId: PublicKey,
  treasuryPda: PublicKey,
  payCountBefore: anchor.BN
): PublicKey {
  const le = payCountBefore.toArrayLike(Buffer, "le", 8);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), treasuryPda.toBuffer(), le],
    programId
  );
  return pda;
}

async function fetchPayCount(
  program: Program<any>,
  treasuryPda: PublicKey
): Promise<anchor.BN> {
  const t: any = await (program.account as any).treasury.fetch(treasuryPda);
  return new anchor.BN(t.payCount.toString());
}

async function buildSetTreasuryPausedTx(args: {
  program: Program<any>;
  authority: Keypair;
  treasuryPda: PublicKey;
  paused: boolean;
}): Promise<Transaction> {
  const { program, authority, treasuryPda, paused } = args;

  const ixDef = getIx(program, "setTreasuryPaused");

  const full: Record<string, PublicKey> = {
    treasuryAuthority: authority.publicKey,
    treasury: treasuryPda,
    systemProgram: SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  };

  const data = program.coder.instruction.encode("setTreasuryPaused", { paused });

  const keys = (ixDef.accounts as any[]).map((acc: any) => {
    const pubkey = full[acc.name];
    if (!pubkey) {
      throw new Error(
        `Missing account '${acc.name}' for setTreasuryPaused. Provided: ${Object.keys(
          full
        ).join(", ")}`
      );
    }
    const { isSigner, isWritable } = accMetaFromIdl(acc);
    return { pubkey, isSigner, isWritable };
  });

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys,
    data,
  });

  return new Transaction().add(ix);
}

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
        `Missing account '${acc.name}' for splDeposit. Provided: ${Object.keys(full).join(
          ", "
        )}`
      );
    }
    const { isSigner, isWritable } = accMetaFromIdl(acc);
    return { pubkey, isSigner, isWritable };
  });

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys,
    data,
  });

  return new Transaction().add(ix);
}

async function buildSplPayTx(args: {
  program: Program<any>;
  treasuryAuthority: Keypair;
  treasuryPda: PublicKey;
  mint: PublicKey;
  recipient: PublicKey;
  recipientAta: PublicKey;
  treasuryAta: PublicKey;
  receipt: PublicKey;
  amount: bigint;
  reference: number[] | null;
  memo: Buffer | Uint8Array | null;
}): Promise<Transaction> {
  const {
    program,
    treasuryAuthority,
    treasuryPda,
    mint,
    recipient,
    recipientAta,
    treasuryAta,
    receipt,
    amount,
    reference,
    memo,
  } = args;

  const ixDef = getIx(program, "splPay");

  const full: Record<string, PublicKey> = {
    treasuryAuthority: treasuryAuthority.publicKey,
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
    else if (lower.includes("reference")) argsObj[a.name] = reference;
    else if (lower.includes("memo")) argsObj[a.name] = memo;
    else if (lower.includes("nonce")) {
      throw new Error("spl_pay.spec.ts expects canonical payCount-mode splPay, not nonce-mode.");
    } else {
      argsObj[a.name] = null;
    }
  }

  const data = program.coder.instruction.encode("splPay", argsObj);

  const keys = (ixDef.accounts as any[]).map((acc: any) => {
    const pubkey = full[acc.name];
    if (!pubkey) {
      throw new Error(
        `Missing account '${acc.name}' for splPay. Provided: ${Object.keys(full).join(
          ", "
        )}`
      );
    }
    const { isSigner, isWritable } = accMetaFromIdl(acc);
    return { pubkey, isSigner, isWritable };
  });

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys,
    data,
  });

  return new Transaction().add(ix);
}

describe("protocol - spl pay (Core17)", function () {
  this.timeout(3_600_000);

  let provider: AnchorProvider;
  let program: Program<Protocol>;
  let programAny: Program<any>;

  let treasuryPda: PublicKey;
  let protocolAuth: Keypair;

  before(async () => {
    const envProvider = anchor.AnchorProvider.env();
    protocolAuth = loadProtocolAuthority();

    provider = new AnchorProvider(
      envProvider.connection,
      new anchor.Wallet(protocolAuth),
      {
        commitment: "finalized",
        preflightCommitment: "finalized",
        skipPreflight: false,
      }
    );
    anchor.setProvider(provider);

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

    programAny = program as Program<any>;

    const foundation = await initFoundationOnce(provider, programAny);
    treasuryPda = foundation.treasuryPda;

    if (!protocolAuth?.secretKey) {
      throw new Error("protocolAuth is not a Keypair (no secretKey) — cannot sign");
    }

    const t: any = await program.account.treasury.fetch(treasuryPda);
    expect(t.authority.toBase58()).to.eq(protocolAuth.publicKey.toBase58());

    const unpauseTx = await buildSetTreasuryPausedTx({
      program: programAny,
      authority: protocolAuth,
      treasuryPda,
      paused: false,
    });

    await sendRawTxFresh({
      provider,
      tx: unpauseTx,
      signers: [protocolAuth],
      commitment: "finalized",
    });
  });

  async function seedTreasury(amount: bigint) {
    const funder = Keypair.generate();
    await airdrop(provider, funder.publicKey, 2, "finalized");

    const setup = await setupMintAndAtas(
      provider,
      funder,
      treasuryPda,
      amount
    );

    const mint = setup.mint;
    const funderAta = setup.userAta;
    const treasuryAta = setup.treasuryAta;

    const depositTx = await buildSplDepositTx({
      program: programAny,
      user: funder,
      treasuryPda,
      mint,
      userAta: funderAta,
      treasuryAta,
      amount,
    });

    await sendRawTxFresh({
      provider,
      tx: depositTx,
      signers: [funder],
      commitment: "finalized",
    });

    return { funder, mint, funderAta, treasuryAta };
  }

  async function payCountBeforeAndReceipt(mint: PublicKey, recipient: PublicKey) {
    const payCountBefore = await fetchPayCount(programAny, treasuryPda);

    const recipientAta = getAssociatedTokenAddressSync(
      mint,
      recipient,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const receiptPda = receiptPdaPayCount(program.programId, treasuryPda, payCountBefore);
    return { payCountBefore, receiptPda, recipientAta };
  }

  after(async () => {
    if (!programAny || !protocolAuth || !treasuryPda) return;

    const tx = await buildSetTreasuryPausedTx({
      program: programAny,
      authority: protocolAuth,
      treasuryPda,
      paused: false,
    });

    await sendRawTxFresh({
      provider,
      tx,
      signers: [protocolAuth],
      commitment: "finalized",
    });
  });

  it("A) pays SPL from treasury to recipient and writes a receipt", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const recipient = Keypair.generate();
    const { receiptPda, recipientAta } = await payCountBeforeAndReceipt(mint, recipient.publicKey);

    const treasuryBefore = await getAccount(
      provider.connection,
      treasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );
    const recipientAtaInfoBefore = await provider.connection.getAccountInfo(recipientAta, "finalized");

    const payAmount = 1234n;

    const payTx = await buildSplPayTx({
      program: programAny,
      treasuryAuthority: protocolAuth,
      treasuryPda,
      mint,
      recipient: recipient.publicKey,
      recipientAta,
      treasuryAta,
      receipt: receiptPda,
      amount: payAmount,
      reference: null,
      memo: null,
    });

    await sendRawTxFresh({
      provider,
      tx: payTx,
      signers: [protocolAuth],
      commitment: "finalized",
    });

    expect(recipientAtaInfoBefore).to.eq(null);

    const recipientAfter = await getAccount(
      provider.connection,
      recipientAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );
    const treasuryAfter = await getAccount(
      provider.connection,
      treasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );

    expect(Number(recipientAfter.amount)).to.eq(Number(payAmount));
    expect(Number(treasuryBefore.amount) - Number(treasuryAfter.amount)).to.eq(Number(payAmount));

    const r: any = await (program.account as any).receipt.fetch(receiptPda);
    expect(toNum(r.amount)).to.eq(Number(payAmount));
    expect(toNum(r.direction)).to.eq(DIR_PAY);

    const rawAsset = r.assetKind ?? r.asset_kind;
    expect(toNum(rawAsset)).to.eq(ASSET_SPL);

    if (r.v2?.splMint) {
      expect(r.v2.splMint.toBase58()).to.eq(mint.toBase58());
    }
  });

  it("B) clarity: recipient does NOT sign; ATA auto-created if missing", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const recipient = Keypair.generate();
    const { receiptPda, recipientAta } = await payCountBeforeAndReceipt(mint, recipient.publicKey);

    const beforeInfo = await provider.connection.getAccountInfo(recipientAta, "finalized");
    expect(beforeInfo).to.eq(null);

    const treasuryBefore = await getAccount(
      provider.connection,
      treasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );

    const payAmount = 555n;

    const payTx = await buildSplPayTx({
      program: programAny,
      treasuryAuthority: protocolAuth,
      treasuryPda,
      mint,
      recipient: recipient.publicKey,
      recipientAta,
      treasuryAta,
      receipt: receiptPda,
      amount: payAmount,
      reference: null,
      memo: null,
    });

    await sendRawTxFresh({
      provider,
      tx: payTx,
      signers: [protocolAuth],
      commitment: "finalized",
    });

    const recipientAfter = await getAccount(
      provider.connection,
      recipientAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );
    expect(Number(recipientAfter.amount)).to.eq(Number(payAmount));

    const treasuryAfter = await getAccount(
      provider.connection,
      treasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );
    expect(Number(treasuryBefore.amount) - Number(treasuryAfter.amount)).to.eq(Number(payAmount));

    const r: any = await (program.account as any).receipt.fetch(receiptPda);
    expect(toNum(r.direction)).to.eq(DIR_PAY);

    const rawAsset = r.assetKind ?? r.asset_kind;
    expect(toNum(rawAsset)).to.eq(ASSET_SPL);
    expect(toNum(r.amount)).to.eq(Number(payAmount));
  });

  it("C) clarity: unauthorized splPay fails", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const attacker = Keypair.generate();
    await airdrop(provider, attacker.publicKey, 2, "finalized");

    const { receiptPda, recipientAta } = await payCountBeforeAndReceipt(mint, attacker.publicKey);

    const payTx = await buildSplPayTx({
      program: programAny,
      treasuryAuthority: attacker,
      treasuryPda,
      mint,
      recipient: attacker.publicKey,
      recipientAta,
      treasuryAta,
      receipt: receiptPda,
      amount: 1n,
      reference: null,
      memo: null,
    });

    await expectFail(
      sendRawTxFresh({
        provider,
        tx: payTx,
        signers: [attacker],
        commitment: "finalized",
      })
    );
  });

  it("D) clarity: pay_count increments (receipt PDA is payCount-based)", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const recipient = Keypair.generate();
    const recipientAta = getAssociatedTokenAddressSync(
      mint,
      recipient.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const payCountBefore = await fetchPayCount(programAny, treasuryPda);
    const receiptPda1 = receiptPdaPayCount(program.programId, treasuryPda, payCountBefore);

    const payTx = await buildSplPayTx({
      program: programAny,
      treasuryAuthority: protocolAuth,
      treasuryPda,
      mint,
      recipient: recipient.publicKey,
      recipientAta,
      treasuryAta,
      receipt: receiptPda1,
      amount: 111n,
      reference: null,
      memo: null,
    });

    await sendRawTxFresh({
      provider,
      tx: payTx,
      signers: [protocolAuth],
      commitment: "finalized",
    });

    const payCountAfter = await fetchPayCount(programAny, treasuryPda);
    expect(payCountAfter.toNumber()).to.eq(payCountBefore.toNumber() + 1);

    const receiptPda2 = receiptPdaPayCount(program.programId, treasuryPda, payCountAfter);
    expect(receiptPda1.toBase58()).to.not.eq(receiptPda2.toBase58());

    const r1: any = await (program.account as any).receipt.fetch(receiptPda1);
    expect(toNum(r1.direction)).to.eq(DIR_PAY);

    const rawAsset = r1.assetKind ?? r1.asset_kind;
    expect(toNum(rawAsset)).to.eq(ASSET_SPL);
    expect(toNum(r1.amount)).to.eq(111);

    if (DEBUG) {
      const treasuryAfterAcc = await getAccount(
        provider.connection,
        treasuryAta,
        "finalized",
        TOKEN_PROGRAM_ID
      );
      const recipientAfterAcc = await getAccount(
        provider.connection,
        recipientAta,
        "finalized",
        TOKEN_PROGRAM_ID
      );
      console.log("payCountBefore:", payCountBefore.toString());
      console.log("payCountAfter:", payCountAfter.toString());
      console.log("receiptPda1:", receiptPda1.toBase58());
      console.log("receiptPda2:", receiptPda2.toBase58());
      console.log("treasuryAfter:", Number(treasuryAfterAcc.amount));
      console.log("recipientAfter:", Number(recipientAfterAcc.amount));
    }
  });

  it("E) clarity: splPay amount=0 fails", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const recipient = Keypair.generate();
    const { receiptPda, recipientAta } = await payCountBeforeAndReceipt(mint, recipient.publicKey);

    const payTx = await buildSplPayTx({
      program: programAny,
      treasuryAuthority: protocolAuth,
      treasuryPda,
      mint,
      recipient: recipient.publicKey,
      recipientAta,
      treasuryAta,
      receipt: receiptPda,
      amount: 0n,
      reference: null,
      memo: null,
    });

    await expectFail(
      sendRawTxFresh({
        provider,
        tx: payTx,
        signers: [protocolAuth],
        commitment: "finalized",
      })
    );
  });

  it("F) clarity: splPay fails while treasury is paused", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const pauseTx = await buildSetTreasuryPausedTx({
      program: programAny,
      authority: protocolAuth,
      treasuryPda,
      paused: true,
    });

    await sendRawTxFresh({
      provider,
      tx: pauseTx,
      signers: [protocolAuth],
      commitment: "finalized",
    });

    try {
      const recipient = Keypair.generate();
      const { receiptPda, recipientAta } = await payCountBeforeAndReceipt(mint, recipient.publicKey);

      const payTx = await buildSplPayTx({
        program: programAny,
        treasuryAuthority: protocolAuth,
        treasuryPda,
        mint,
        recipient: recipient.publicKey,
        recipientAta,
        treasuryAta,
        receipt: receiptPda,
        amount: 1n,
        reference: null,
        memo: null,
      });

      await expectFail(
        sendRawTxFresh({
          provider,
          tx: payTx,
          signers: [protocolAuth],
          commitment: "finalized",
        })
      );
    } finally {
      const unpauseTx = await buildSetTreasuryPausedTx({
        program: programAny,
        authority: protocolAuth,
        treasuryPda,
        paused: false,
      });

      await sendRawTxFresh({
        provider,
        tx: unpauseTx,
        signers: [protocolAuth],
        commitment: "finalized",
      });
    }
  });

  it("Core21) splPay writes reference + memo metadata into receipt.v2", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const recipient = Keypair.generate();
    const { receiptPda, recipientAta } = await payCountBeforeAndReceipt(mint, recipient.publicKey);

    const reference = new Array(32).fill(7);
    const memoBuf = Buffer.from("invoice:1234|core21", "utf8");

    const payTx = await buildSplPayTx({
      program: programAny,
      treasuryAuthority: protocolAuth,
      treasuryPda,
      mint,
      recipient: recipient.publicKey,
      recipientAta,
      treasuryAta,
      receipt: receiptPda,
      amount: 777n,
      reference,
      memo: memoBuf,
    });

    await sendRawTxFresh({
      provider,
      tx: payTx,
      signers: [protocolAuth],
      commitment: "finalized",
    });

    const r: any = await (program.account as any).receipt.fetch(receiptPda);

    expect(toNum(r.v2.flags)).to.eq(V2_FLAG_HAS_REFERENCE | V2_FLAG_HAS_MEMO);
    expect(Array.from(r.v2.reference)).to.deep.eq(reference);
    expect(toNum(r.v2.memoLen)).to.eq(memoBuf.length);

    const gotMemo = Uint8Array.from(r.v2.memo).slice(0, toNum(r.v2.memoLen));
    expect(Array.from(gotMemo)).to.deep.eq(Array.from(memoBuf));
  });

  it("Core21) splPay with null metadata stores empty v2 fields", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const recipient = Keypair.generate();
    const { receiptPda, recipientAta } = await payCountBeforeAndReceipt(mint, recipient.publicKey);

    const payTx = await buildSplPayTx({
      program: programAny,
      treasuryAuthority: protocolAuth,
      treasuryPda,
      mint,
      recipient: recipient.publicKey,
      recipientAta,
      treasuryAta,
      receipt: receiptPda,
      amount: 42n,
      reference: null,
      memo: null,
    });

    await sendRawTxFresh({
      provider,
      tx: payTx,
      signers: [protocolAuth],
      commitment: "finalized",
    });

    const r: any = await (program.account as any).receipt.fetch(receiptPda);

    expect(toNum(r.v2.flags)).to.eq(0);
    expect(toNum(r.v2.memoLen)).to.eq(0);
    expect(Array.from(r.v2.reference)).to.deep.eq(Array.from(new Uint8Array(32)));
  });

  it("Core21) splPay rejects memo > 64 bytes", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const recipient = Keypair.generate();
    const { receiptPda, recipientAta } = await payCountBeforeAndReceipt(mint, recipient.publicKey);

    const reference = new Array(32).fill(1);
    const tooLongMemo = Buffer.from(new Uint8Array(65).fill(9));

    let threw = false;
    try {
      const payTx = await buildSplPayTx({
        program: programAny,
        treasuryAuthority: protocolAuth,
        treasuryPda,
        mint,
        recipient: recipient.publicKey,
        recipientAta,
        treasuryAta,
        receipt: receiptPda,
        amount: 1n,
        reference,
        memo: tooLongMemo,
      });

      await sendRawTxFresh({
        provider,
        tx: payTx,
        signers: [protocolAuth],
        commitment: "finalized",
      });
    } catch (e: any) {
      threw = true;
      const msg = String(e?.message ?? e).toLowerCase();
      expect(msg).to.satisfy(
        (m: string) => m.includes("memo too long") || m.includes("memotoolong")
      );
      if (DEBUG) console.log("memo>64 threw as expected:", msg);
    }

    expect(threw).to.eq(true);
  });
});

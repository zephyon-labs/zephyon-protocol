// tests/stress_tier2_interleaved.spec.ts
//
// Tier2A — Interleaved Chaos (STRICT)
// PAY + PAUSE under controlled concurrency.
//
// Canonical model:
// - splPay receipts are payCount-based
// - receipt seeds = ["receipt", treasuryPda, pay_count_before(u64LE)]
// - use canonical setupMintAndAtas funding path
// - explicitly deposit into treasury before PAY
//
// Invariants:
// - treasuryDelta == recipientDelta == sumSuccessfulPays
// - rejected paused PAYs do not increment pay_count
// - rejected paused PAYs do not create receipts

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
import { expect } from "chai";

import {
  loadProtocolAuthority,
  initFoundationOnce,
  airdrop,
  setupMintAndAtas,
} from "./_helpers";

/* -----------------------------
 * tiny utilities
 * ----------------------------- */

const bn = (x: number | string | bigint) => new anchor.BN(x.toString());

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function u64LEBigInt(n: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

function assertProviderIsAuthority(provider: AnchorProvider, auth: PublicKey) {
  const pk = (provider.wallet as any).publicKey as PublicKey;
  if (!pk?.equals(auth)) {
    throw new Error(
      `Provider wallet drift: provider=${pk?.toBase58?.()} expected=${auth.toBase58()}`
    );
  }
}

async function runBounded<T>(
  items: T[],
  limit: number,
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

function isRetryable(e: any) {
  const s = String(e?.message ?? e);
  return (
    s.includes("AccountInUse") ||
    s.toLowerCase().includes("already in use") ||
    s.includes("Blockhash not found") ||
    s.includes("Transaction was not confirmed") ||
    s.includes("Node is behind") ||
    s.includes("429") ||
    s.toLowerCase().includes("timeout") ||
    s.toLowerCase().includes("timed out")
  );
}

function isPausedLike(e: any) {
  const msg = String(e?.message ?? e).toLowerCase();
  return (
    msg.includes("protocolpaused") ||
    msg.includes("treasurypaused") ||
    msg.includes("paused") ||
    msg.includes("custom program error: 0x1770")
  );
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  tries = 8,
  baseDelayMs = 80
): Promise<T> {
  let lastErr: any;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;

      if (isPausedLike(e)) throw e;
      if (!isRetryable(e)) throw e;

      await sleep(baseDelayMs + i * 40);
    }
  }

  throw new Error(
    `withRetry exhausted (${label}): ${String(lastErr?.message ?? lastErr)}`
  );
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

/* -----------------------------
 * transport helpers
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
 * state helpers
 * ----------------------------- */

function derivePayReceiptPda(
  programId: PublicKey,
  treasuryPda: PublicKey,
  payCountBefore: bigint
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), treasuryPda.toBuffer(), u64LEBigInt(payCountBefore)],
    programId
  )[0];
}

async function getTreasuryPayCount(
  program: Program<any>,
  treasuryPda: PublicKey
): Promise<bigint> {
  const programAny = program as any;
  const treasuryAcc: any = await programAny.account.treasury.fetch(treasuryPda);
  return BigInt(treasuryAcc.payCount.toString());
}

async function receiptExists(
  provider: AnchorProvider,
  receipt: PublicKey
): Promise<boolean> {
  const info = await provider.connection.getAccountInfo(receipt, "finalized");
  return !!info;
}

async function ensureAtaExists(args: {
  provider: AnchorProvider;
  payer: Keypair;
  owner: PublicKey;
  mint: PublicKey;
  allowOwnerOffCurve?: boolean;
}): Promise<PublicKey> {
  const {
    provider,
    payer,
    owner,
    mint,
    allowOwnerOffCurve = false,
  } = args;

  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    allowOwnerOffCurve,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const existing = await provider.connection.getAccountInfo(ata, "finalized");
  if (existing) return ata;

  await withRetry(
    async () => {
      const ix = createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        owner,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const tx = new Transaction().add(ix);

      try {
        await sendRawTxFresh({
          provider,
          tx,
          signers: [payer],
          commitment: "finalized",
        });
      } catch (e: any) {
        const msg = String(e?.message ?? e).toLowerCase();

        if (
          msg.includes("already in use") ||
          msg.includes("custom program error: 0x0")
        ) {
          const nowExists = await provider.connection.getAccountInfo(ata, "finalized");
          if (nowExists) return;
        }

        throw e;
      }
    },
    `ensure-ata-${ata.toBase58().slice(0, 8)}`,
    8,
    120
  );

  const finalInfo = await provider.connection.getAccountInfo(ata, "finalized");
  if (!finalInfo) {
    throw new Error(`ATA still missing after create: ${ata.toBase58()}`);
  }

  return ata;
}

/* -----------------------------
 * STRICT instruction builders
 * ----------------------------- */

async function setTreasuryPausedStrict(args: {
  program: Program<any>;
  authority: Keypair;
  treasuryPda: PublicKey;
  paused: boolean;
}) {
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

  const tx = new Transaction().add(ix);

  await sendRawTxFresh({
    provider: program.provider as AnchorProvider,
    tx,
    signers: [authority],
    commitment: "finalized",
  });
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
      throw new Error(
        "Tier2A rewrite expects canonical payCount-mode splPay, not nonce-mode."
      );
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

/* -----------------------------
 * SPEC
 * ----------------------------- */

describe("stress - Tier2 interleaved chaos (STRICT)", function () {
  this.timeout(3_600_000);

  let provider: AnchorProvider;
  let program: Program<any>;

  let protocolAuth: Keypair;
  let treasuryPda: PublicKey;

  let mint: PublicKey;
  let treasuryAta: PublicKey;
  let userAta: PublicKey;

  const recipient = Keypair.generate();
  let recipientAta: PublicKey;

  before(async () => {
    const envProvider = AnchorProvider.env();
    protocolAuth = loadProtocolAuthority();

    await airdrop(envProvider, protocolAuth.publicKey, 2, "finalized");
    await airdrop(envProvider, recipient.publicKey, 1, "finalized");
    await sleep(150);

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

    assertProviderIsAuthority(provider, protocolAuth.publicKey);

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

    [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );

    await initFoundationOnce(provider, program);

    const setup = await setupMintAndAtas(
      provider,
      protocolAuth,
      treasuryPda,
      5_000_000n
    );

    mint = setup.mint;
    treasuryAta = setup.treasuryAta;
    userAta = setup.userAta;

    const depositTx = await buildSplDepositTx({
      program,
      user: protocolAuth,
      treasuryPda,
      mint,
      userAta,
      treasuryAta,
      amount: 5_000_000n,
    });

    await sendRawTxFresh({
      provider,
      tx: depositTx,
      signers: [protocolAuth],
      commitment: "finalized",
    });

    recipientAta = getAssociatedTokenAddressSync(
      mint,
      recipient.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const existing = await provider.connection.getAccountInfo(recipientAta, "finalized");
    if (!existing) {
      await ensureAtaExists({
        provider,
        payer: protocolAuth,
        owner: recipient.publicKey,
        mint,
        allowOwnerOffCurve: false,
      });
    }

    await withRetry(
      async () => {
        await setTreasuryPausedStrict({
          program,
          authority: protocolAuth,
          treasuryPda,
          paused: false,
        });
      },
      "tier2a-unpause-start",
      8,
      100
    );

    const t = await getAccount(provider.connection, treasuryAta, "finalized", TOKEN_PROGRAM_ID);
    console.log("Tier2A treasury funded:", t.amount.toString());
  });

  it("Layer2A: interleaves PAY + PAUSE without invariant drift (deterministic)", async () => {
    const CYCLES = Number(process.env.TIER2A_CYCLES ?? "20");
    const CONCURRENCY = Number(process.env.TIER2A_CONCURRENCY ?? "5");

    const treasuryBefore = await getAccount(
      provider.connection,
      treasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );
    const recipientBefore = await getAccount(
      provider.connection,
      recipientAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );

    let pauseSets = 0;
    let successPays = 0;
    let rejectedPays = 0;
    let sumSuccessful = 0n;

    const stateLock = createMutex();
    const cycles = Array.from({ length: CYCLES }, (_, i) => i);

    await runBounded(cycles, CONCURRENCY, async (cycleIdx) => {
      await sleep((cycleIdx % 5) * 10);

      await stateLock(async () => {
        assertProviderIsAuthority(provider, protocolAuth.publicKey);

        await withRetry(
          async () => {
            await setTreasuryPausedStrict({
              program,
              authority: protocolAuth,
              treasuryPda,
              paused: false,
            });
          },
          `cycle-${cycleIdx}-unpause-a`,
          8,
          80
        );
        pauseSets++;

        const amountOk = 111 + cycleIdx;
        const payCountBeforeSuccess = await getTreasuryPayCount(program, treasuryPda);
        const receiptSuccess = derivePayReceiptPda(
          program.programId,
          treasuryPda,
          payCountBeforeSuccess
        );

        const payTx = await buildSplPayTx({
          program,
          authority: protocolAuth,
          treasuryPda,
          treasuryAta,
          mint,
          recipient: recipient.publicKey,
          recipientAta,
          receipt: receiptSuccess,
          amount: amountOk,
        });

        await sendRawTxFresh({
          provider,
          tx: payTx,
          signers: [protocolAuth],
          commitment: "finalized",
        });

        const payCountAfterSuccess = await getTreasuryPayCount(program, treasuryPda);
        expect(
          payCountAfterSuccess.toString(),
          `cycle ${cycleIdx}: successful PAY did not increment pay_count`
        ).to.eq((payCountBeforeSuccess + 1n).toString());

        const successReceiptExists = await receiptExists(provider, receiptSuccess);
        expect(
          successReceiptExists,
          `cycle ${cycleIdx}: successful PAY failed to create receipt`
        ).to.eq(true);

        successPays++;
        sumSuccessful += BigInt(amountOk);

        await withRetry(
          async () => {
            await setTreasuryPausedStrict({
              program,
              authority: protocolAuth,
              treasuryPda,
              paused: true,
            });
          },
          `cycle-${cycleIdx}-pause`,
          8,
          80
        );
        pauseSets++;

        const amountReject = 222 + cycleIdx;
        const payCountBeforeReject = await getTreasuryPayCount(program, treasuryPda);
        const receiptReject = derivePayReceiptPda(
          program.programId,
          treasuryPda,
          payCountBeforeReject
        );

        try {
          const pausedTx = await buildSplPayTx({
            program,
            authority: protocolAuth,
            treasuryPda,
            treasuryAta,
            mint,
            recipient: recipient.publicKey,
            recipientAta,
            receipt: receiptReject,
            amount: amountReject,
          });

          await sendRawTxFresh({
            provider,
            tx: pausedTx,
            signers: [protocolAuth],
            commitment: "finalized",
          });

          throw new Error(
            `Governance breach: PAY succeeded while paused (cycle=${cycleIdx})`
          );
        } catch (e: any) {
          if (!isPausedLike(e)) throw e;

          rejectedPays++;

          const payCountAfterReject = await getTreasuryPayCount(program, treasuryPda);
          expect(
            payCountAfterReject.toString(),
            `cycle ${cycleIdx}: paused PAY incremented pay_count`
          ).to.eq(payCountBeforeReject.toString());

          const rejectReceiptExists = await receiptExists(provider, receiptReject);
          expect(
            rejectReceiptExists,
            `cycle ${cycleIdx}: paused PAY created receipt`
          ).to.eq(false);
        }

        await withRetry(
          async () => {
            await setTreasuryPausedStrict({
              program,
              authority: protocolAuth,
              treasuryPda,
              paused: false,
            });
          },
          `cycle-${cycleIdx}-unpause-b`,
          8,
          80
        );
        pauseSets++;
      });
    });

    await withRetry(
      async () => {
        await setTreasuryPausedStrict({
          program,
          authority: protocolAuth,
          treasuryPda,
          paused: false,
        });
      },
      "tier2a-unpause-end",
      8,
      100
    );

    const treasuryAfter = await getAccount(
      provider.connection,
      treasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );
    const recipientAfter = await getAccount(
      provider.connection,
      recipientAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );

    const treasuryDelta = treasuryBefore.amount - treasuryAfter.amount;
    const recipientDelta = recipientAfter.amount - recipientBefore.amount;

    console.log("Tier2A Evidence:", {
      CYCLES,
      CONCURRENCY,
      pauseSets,
      successPays,
      rejectedPays,
      sumSuccessful: sumSuccessful.toString(),
      treasuryBefore: treasuryBefore.amount.toString(),
      treasuryAfter: treasuryAfter.amount.toString(),
      recipientBefore: recipientBefore.amount.toString(),
      recipientAfter: recipientAfter.amount.toString(),
      treasuryDelta: treasuryDelta.toString(),
      recipientDelta: recipientDelta.toString(),
    });

    expect(pauseSets).to.be.greaterThan(0);
    expect(successPays).to.eq(CYCLES);
    expect(rejectedPays).to.eq(CYCLES);

    expect(
      treasuryDelta.toString(),
      "treasuryDelta != recipientDelta"
    ).to.eq(recipientDelta.toString());

    expect(
      treasuryDelta.toString(),
      "treasuryDelta != sumSuccessfulPays"
    ).to.eq(sumSuccessful.toString());
  });

  after(async () => {
    if (!program || !protocolAuth || !treasuryPda) return;

    await withRetry(
      async () => {
        await setTreasuryPausedStrict({
          program,
          authority: protocolAuth,
          treasuryPda,
          paused: false,
        });
      },
      "tier2a-after-unpause",
      8,
      100
    );
  });
});




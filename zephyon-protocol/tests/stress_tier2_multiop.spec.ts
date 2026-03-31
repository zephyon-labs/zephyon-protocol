/**
 * tests/stress_tier2_multiop.spec.ts
 *
 * Tier2B — Multi-Op Interleaved Chaos (STRICT)
 * PAY + WITHDRAW + PAUSE under controlled concurrency.
 *
 * Canonical (post-v0.31.x):
 * - splPay receipts are payCount-based:
 *   seeds = ["receipt", treasuryPda, pay_count_before(u64LE)]
 *
 * Design goals:
 * - Provider locked to protocolAuth (no wallet drift)
 * - Program bound from runtime workspace IDL (no static JSON drift)
 * - STRICT raw instruction encoding for splPay / splWithdraw / setTreasuryPaused
 * - PAY critical section serialized to avoid pay_count receipt collisions
 * - Successful PAYs create receipts
 * - Rejected paused PAYs do not create receipts and do not increment pay_count
 * - Successful WITHDRAWs move value only to authority user ATA
 * - Rejected paused WITHDRAWs do not move value
 *
 * Invariants:
 * - treasuryDelta == sumSuccessfulPays + sumSuccessfulWithdraws
 * - recipientDelta == sumSuccessfulPays
 * - userDelta == sumSuccessfulWithdraws
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
  createMint,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";

import {
  loadProtocolAuthority,
  initFoundationOnce,
  airdrop,
} from "./_helpers";

/* -----------------------------
 * types + tiny utilities
 * ----------------------------- */

type Step =
  | { kind: "PAUSE"; paused: boolean; tag: string }
  | { kind: "PAY"; amount: number; tag: string }
  | { kind: "WITHDRAW"; amount: number; tag: string };

const bn = (x: number | string | bigint) => new anchor.BN(x.toString());

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function u64LEBigInt(n: bigint): Buffer {
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
  const s = String(e?.message ?? e).toLowerCase();
  return (
    s.includes("protocolpaused") ||
    s.includes("treasurypaused") ||
    s.includes("protocol is paused") ||
    s.includes("paused") ||
    s.includes("custom program error: 0x1770")
  );
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  tries = 10,
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
 * transport helper
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
    commitment = "confirmed",
  } = args;

  const feePayer = signers[0]?.publicKey ?? (provider.wallet as any).publicKey;
  tx.feePayer = feePayer;

  const latest = await provider.connection.getLatestBlockhash(commitment);
  tx.recentBlockhash = latest.blockhash;
  tx.sign(...signers);

  const sig = await provider.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: commitment,
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

  const info = await provider.connection.getTransaction(sig, {
    commitment: commitment as anchor.web3.Finality,
    maxSupportedTransactionVersion: 0,
  });

  if (!info) {
    throw new Error(`sendRawTxFresh: transaction not found after confirmation: ${sig}`);
  }

  if (info.meta?.err) {
    const logs = info.meta.logMessages ?? [];
    throw new Error(
      `sendRawTxFresh: transaction failed on-chain: ${JSON.stringify(info.meta.err)}\n` +
        logs.join("\n")
    );
  }

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
  const info = await provider.connection.getAccountInfo(receipt, "confirmed");
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

  const mintInfo = await provider.connection.getAccountInfo(mint, "confirmed");
  if (!mintInfo) {
    throw new Error(`Mint account missing: ${mint.toBase58()}`);
  }

  const tokenProgramForMint = mintInfo.owner;

  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    allowOwnerOffCurve,
    tokenProgramForMint,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const existing = await provider.connection.getAccountInfo(ata, "confirmed");
  if (existing) return ata;

  const ix = createAssociatedTokenAccountInstruction(
    payer.publicKey,
    ata,
    owner,
    mint,
    tokenProgramForMint,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  await withRetry(
    async () => {
      try {
        const tx = new Transaction().add(ix);
        await sendRawTxFresh({
          provider,
          tx,
          signers: [payer],
          commitment: "confirmed",
        });
      } catch (e: any) {
        const msg = String(e?.message ?? e).toLowerCase();

        if (
          msg.includes("already in use") ||
          msg.includes("custom program error: 0x0")
        ) {
          const nowExists = await provider.connection.getAccountInfo(ata, "confirmed");
          if (nowExists) return;
        }

        throw e;
      }
    },
    `ensure-ata-${ata.toBase58().slice(0, 8)}`,
    8,
    120
  );

  const finalInfo = await provider.connection.getAccountInfo(ata, "confirmed");
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
    commitment: "confirmed",
  });
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
        "Tier2 multiop rewrite expects canonical payCount-mode splPay, not nonce-mode."
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

async function buildSplWithdrawTx(args: {
  program: Program<any>;
  authority: Keypair;
  treasuryPda: PublicKey;
  mint: PublicKey;
  userAta: PublicKey;
  treasuryAta: PublicKey;
  amount: number;
}): Promise<Transaction> {
  const {
    program,
    authority,
    treasuryPda,
    mint,
    userAta,
    treasuryAta,
    amount,
  } = args;

  const ixDef = getIx(program, "splWithdraw");

  const full: Record<string, PublicKey> = {
    treasuryAuthority: authority.publicKey,
    user: authority.publicKey,
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

  const data = program.coder.instruction.encode("splWithdraw", argsObj);

  const keys = (ixDef.accounts as any[]).map((acc: any) => {
    const pubkey = full[acc.name];
    if (!pubkey) {
      throw new Error(
        `Missing account '${acc.name}' for splWithdraw. Provided: ${Object.keys(
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

/* -----------------------------
 * test
 * ----------------------------- */

describe("stress - Tier2 multiop interleaved chaos (STRICT)", () => {
  let provider: AnchorProvider;
  let program: Program<any>;

  let protocolAuth: Keypair;
  let treasuryPda: PublicKey;

  let mint: PublicKey;
  let treasuryAta: PublicKey;

  const recipient = Keypair.generate();
  let recipientAta: PublicKey;
  let authUserAta: PublicKey;

  before(async () => {
    const envProvider = AnchorProvider.env();
    protocolAuth = loadProtocolAuthority();

    await airdrop(envProvider, protocolAuth.publicKey, 2);
    await airdrop(envProvider, recipient.publicKey, 2);
    await sleep(150);

    provider = new AnchorProvider(
      envProvider.connection,
      new anchor.Wallet(protocolAuth),
      {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
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

    mint = await createMint(
      provider.connection,
      protocolAuth,
      protocolAuth.publicKey,
      null,
      6,
      undefined,
      {
        commitment: "finalized",
        preflightCommitment: "finalized",
        skipPreflight: false,
      },
      TOKEN_PROGRAM_ID
    );

    await withRetry(
      async () => {
        const mintInfo = await provider.connection.getAccountInfo(mint, "finalized");
        if (!mintInfo) {
          throw new Error(`Mint not visible yet: ${mint.toBase58()}`);
        }

        if (!mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
          throw new Error(
            `Mint owner mismatch: mint=${mint.toBase58()} owner=${mintInfo.owner.toBase58()} expected=${TOKEN_PROGRAM_ID.toBase58()}`
          );
        }
      },
      "tier2b-mint-visible",
      12,
      100
    );

    treasuryAta = await ensureAtaExists({
      provider,
      payer: protocolAuth,
      owner: treasuryPda,
      mint,
      allowOwnerOffCurve: true,
    });

    recipientAta = await ensureAtaExists({
      provider,
      payer: protocolAuth,
      owner: recipient.publicKey,
      mint,
      allowOwnerOffCurve: false,
    });

    authUserAta = await ensureAtaExists({
      provider,
      payer: protocolAuth,
      owner: protocolAuth.publicKey,
      mint,
      allowOwnerOffCurve: false,
    });

    await withRetry(
      async () => {
        await mintTo(
          provider.connection,
          protocolAuth,
          mint,
          treasuryAta,
          protocolAuth.publicKey,
          10_000_000
        );
      },
      "tier2b-mintTo",
      8,
      120
    );

    await withRetry(
      async () => {
        await setTreasuryPausedStrict({
          program,
          authority: protocolAuth,
          treasuryPda,
          paused: false,
        });
      },
      "tier2b-unpause-start",
      8,
      100
    );
  });

  it("Layer2B: interleaves PAY + WITHDRAW + PAUSE without invariant drift", async () => {
    const CONCURRENCY = Number(process.env.TIER2B_CONCURRENCY ?? "4");

    const treasuryBefore = await getAccount(
      provider.connection,
      treasuryAta,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
    const recipientBefore = await getAccount(
      provider.connection,
      recipientAta,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
    const userBefore = await getAccount(
      provider.connection,
      authUserAta,
      "confirmed",
      TOKEN_PROGRAM_ID
    );

    const steps: Step[] = [];

    for (let i = 0; i < 8; i++) {
      steps.push({ kind: "PAY", amount: 30 + i, tag: `warm-pay-${i}` });
    }
    for (let i = 0; i < 3; i++) {
      steps.push({ kind: "WITHDRAW", amount: 12 + i, tag: `warm-withdraw-${i}` });
    }

    steps.push({ kind: "PAUSE", paused: true, tag: "pause-on-1" });
    for (let i = 0; i < 8; i++) {
      steps.push({ kind: "PAY", amount: 40 + i, tag: `paused-pay-${i}` });
    }
    for (let i = 0; i < 3; i++) {
      steps.push({ kind: "WITHDRAW", amount: 15 + i, tag: `paused-withdraw-${i}` });
    }

    steps.push({ kind: "PAUSE", paused: false, tag: "pause-off-1" });
    for (let i = 0; i < 8; i++) {
      steps.push({ kind: "PAY", amount: 55 + i, tag: `open2-pay-${i}` });
    }
    for (let i = 0; i < 3; i++) {
      steps.push({ kind: "WITHDRAW", amount: 18 + i, tag: `open2-withdraw-${i}` });
    }

    steps.push({ kind: "PAUSE", paused: false, tag: "final-unpause" });

    let pauseSets = 0;

    let successPays = 0;
    let rejectedPays = 0;
    let sumPays = 0n;

    let successWithdraws = 0;
    let rejectedWithdraws = 0;
    let sumWithdraws = 0n;

    const payLock = createMutex();

    try {
      await runBounded(steps, CONCURRENCY, async (step, idx) => {
        await withRetry(
          async () => {
            assertProviderIsAuthority(provider, protocolAuth.publicKey);

            if (step.kind === "PAUSE") {
              await setTreasuryPausedStrict({
                program,
                authority: protocolAuth,
                treasuryPda,
                paused: step.paused,
              });
              pauseSets++;
              return;
            }

            if (step.kind === "PAY") {
              await payLock(async () => {
                const payCountBefore = await getTreasuryPayCount(program, treasuryPda);
                const receipt = derivePayReceiptPda(
                  program.programId,
                  treasuryPda,
                  payCountBefore
                );

                try {
                  const tx = await buildSplPayTx({
                    program,
                    authority: protocolAuth,
                    treasuryPda,
                    treasuryAta,
                    mint,
                    recipient: recipient.publicKey,
                    recipientAta,
                    receipt,
                    amount: step.amount,
                  });

                  await sendRawTxFresh({
                    provider,
                    tx,
                    signers: [protocolAuth],
                    commitment: "confirmed",
                  });

                  await withRetry(
                    async () => {
                      const payCountAfter = await getTreasuryPayCount(program, treasuryPda);
                      expect(
                        payCountAfter >= payCountBefore + 1n,
                        `PAY success did not advance pay_count [${step.tag}]`
                      ).to.eq(true);
                    },
                    `verify-pay-success-${step.tag}`,
                    8,
                    80
                  );

                  successPays++;
                  sumPays += BigInt(step.amount);
                } catch (e: any) {
                  if (!isPausedLike(e)) throw e;

                  await withRetry(
                    async () => {
                      const payCountAfter = await getTreasuryPayCount(program, treasuryPda);
                      expect(
                        payCountAfter.toString(),
                        `Paused PAY incremented pay_count [${step.tag}]`
                      ).to.eq(payCountBefore.toString());

                      const exists = await receiptExists(provider, receipt);
                      expect(
                        exists,
                        `Paused PAY created receipt [${step.tag}]`
                      ).to.eq(false);
                    },
                    `verify-pay-reject-${step.tag}`,
                    8,
                    80
                  );

                  rejectedPays++;
                }
              });
              return;
            }

            try {
              const tx = await buildSplWithdrawTx({
                program,
                authority: protocolAuth,
                treasuryPda,
                mint,
                userAta: authUserAta,
                treasuryAta,
                amount: step.amount,
              });

              await sendRawTxFresh({
                provider,
                tx,
                signers: [protocolAuth],
                commitment: "confirmed",
              });

              successWithdraws++;
              sumWithdraws += BigInt(step.amount);
            } catch (e: any) {
              if (!isPausedLike(e)) throw e;
              rejectedWithdraws++;
            }
          },
          `step-${idx}-${step.tag}`,
          10,
          80
        );
      });
    } finally {
      await withRetry(
        async () => {
          await setTreasuryPausedStrict({
            program,
            authority: protocolAuth,
            treasuryPda,
            paused: false,
          });
        },
        "tier2b-unpause-end",
        8,
        100
      );
    }

    const treasuryAfter = await getAccount(
      provider.connection,
      treasuryAta,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
    const recipientAfter = await getAccount(
      provider.connection,
      recipientAta,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
    const userAfter = await getAccount(
      provider.connection,
      authUserAta,
      "confirmed",
      TOKEN_PROGRAM_ID
    );

    const treasuryDelta = treasuryBefore.amount - treasuryAfter.amount;
    const recipientDelta = recipientAfter.amount - recipientBefore.amount;
    const userDelta = userAfter.amount - userBefore.amount;

    console.log("Layer2B results:", {
      CONCURRENCY,
      pauseSets,
      successPays,
      rejectedPays,
      sumPays: sumPays.toString(),
      successWithdraws,
      rejectedWithdraws,
      sumWithdraws: sumWithdraws.toString(),
      treasuryBefore: treasuryBefore.amount.toString(),
      treasuryAfter: treasuryAfter.amount.toString(),
      treasuryDelta: treasuryDelta.toString(),
      recipientBefore: recipientBefore.amount.toString(),
      recipientAfter: recipientAfter.amount.toString(),
      recipientDelta: recipientDelta.toString(),
      userBefore: userBefore.amount.toString(),
      userAfter: userAfter.amount.toString(),
      userDelta: userDelta.toString(),
    });

    expect(pauseSets).to.be.greaterThan(0);

    expect(successPays).to.be.greaterThan(0);
    expect(rejectedPays).to.be.greaterThan(0);

    expect(successWithdraws).to.be.greaterThan(0);
    expect(rejectedWithdraws).to.be.greaterThan(0);

    expect(
      treasuryDelta.toString(),
      "treasuryDelta != sumPays + sumWithdraws"
    ).to.eq((sumPays + sumWithdraws).toString());

    expect(
      recipientDelta.toString(),
      "recipientDelta != sumPays"
    ).to.eq(sumPays.toString());

    expect(
      userDelta.toString(),
      "userDelta != sumWithdraws"
    ).to.eq(sumWithdraws.toString());
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
      "tier2b-after-unpause",
      8,
      100
    );
  });
});
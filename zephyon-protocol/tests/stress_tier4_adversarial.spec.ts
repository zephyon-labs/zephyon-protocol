// tests/stress_tier4_adversarial_seeded.spec.ts
//
// Tier4 (Seeded): adversarial scheduler with deterministic randomness.
// - Random pause/unpause window sizes
// - Random concurrency bursts
// - Random per-attempt jitter
// - Random pay amounts
//
// Requirements:
// - Uses STRICT raw instruction encoding (no .methods.validateAccounts)
// - Replayable by seed
// - Invariants: treasuryDelta == sumSuccessfulPays == recipientAggregateDelta
//
// NOTE on reruns:
// If receipts already exist (same seed + same nonce plan), we treat that attempt as SKIPPED
// and we do NOT count it toward sumSuccessfulPays. This keeps invariants honest.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";

import { loadProtocolAuthority, airdrop, withRetry, NONCE_PAY_BASE } from "./_helpers";

// ---------- tiny utils ----------
type BN = anchor.BN;
const bn = (x: number | string | bigint) => new anchor.BN(x.toString());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function u64LE(n: anchor.BN) {
  return n.toArrayLike(Buffer, "le", 8);
}

// Seeded RNG (mulberry32)
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randInt(rng: () => number, min: number, maxInclusive: number) {
  return Math.floor(rng() * (maxInclusive - min + 1)) + min;
}
function pick<T>(rng: () => number, arr: T[]) {
  return arr[Math.floor(rng() * arr.length)];
}

function isPauseError(e: any): boolean {
  const s = String(e?.message ?? e);
  return s.includes("TreasuryPaused") || s.toLowerCase().includes("paused");
}

async function ensureAtaExists(provider: anchor.AnchorProvider, payer: Keypair, mint: PublicKey) {
  const ata = getAssociatedTokenAddressSync(mint, payer.publicKey, false);
  const info = await provider.connection.getAccountInfo(ata);
  if (info) return ata;

  const ix = createAssociatedTokenAccountInstruction(
    payer.publicKey, // payer
    ata,
    payer.publicKey, // owner
    mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const tx = new anchor.web3.Transaction().add(ix);
  await provider.sendAndConfirm(tx, [payer], { commitment: "confirmed" });
  return ata;
}

function getIx(program: Program<any>, name: string): any {
  const ix = (program.idl.instructions as any[]).find((i) => i.name === name);
  if (!ix) throw new Error(`IDL instruction not found: ${name}`);
  return ix;
}

// Compat: IDL fields vary across Anchor versions
function accMetaFromIdl(acc: any) {
  const isSigner = !!acc.isSigner;
  const isWritable = !!acc.isMut || !!acc.isWritable || !!acc.writable || false;
  return { isSigner, isWritable };
}

/* -----------------------------
 * Receipt derivation (ADAPTIVE)
 * ----------------------------- */

/**
 * Detect whether IDL splPay has a nonce-ish argument.
 * If YES => receipt seed is nonce (nonce-mode).
 * If NO  => receipt seed is treasury.payCount BEFORE pay (payCount-mode).
 */
function splPayHasNonceArg(program: Program<any>): boolean {
  const ix = (program.idl.instructions as any[]).find((i) => i.name === "splPay");
  if (!ix) throw new Error("IDL missing instruction splPay");
  return (ix.args as any[]).some((a) => String(a.name).toLowerCase().includes("nonce"));
}

function receiptPda(programId: PublicKey, treasuryPda: PublicKey, seedValue: anchor.BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), treasuryPda.toBuffer(), u64LE(seedValue)],
    programId
  )[0];
}

async function deriveReceiptPdaAdaptive(args: {
  program: Program<any>;
  treasuryPda: PublicKey;
  nonceIfUsed: anchor.BN;
}): Promise<{ receipt: PublicKey; seedValue: anchor.BN; usesNonce: boolean }> {
  const { program, treasuryPda, nonceIfUsed } = args;

  const usesNonce = splPayHasNonceArg(program);

  let seedValue: anchor.BN;
  if (usesNonce) {
    seedValue = nonceIfUsed;
  } else {
    // payCount-mode: read payCountBefore from treasury account
    const programAny = program as any; // avoid TS "account namespace" complaints
    const treasuryAcc: any = await programAny.account.treasury.fetch(treasuryPda);
    seedValue = new anchor.BN(treasuryAcc.payCount);
  }

  return { receipt: receiptPda(program.programId, treasuryPda, seedValue), seedValue, usesNonce };
}

/**
 * Simple async mutex for serializing PAY critical section when in payCount-mode.
 * If two PAYs fetch payCount simultaneously, they derive the SAME receipt PDA => collision.
 */
function createMutex() {
  let chain = Promise.resolve();
  return async function lock<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(fn, fn);
    chain = next.then(() => undefined, () => undefined);
    return next;
  };
}

// ---------- STRICT raw instruction builders ----------

async function setTreasuryPausedStrict(
  program: Program<any>,
  authority: Keypair,
  treasuryPda: PublicKey,
  paused: boolean
) {
  const ixDef = getIx(program, "setTreasuryPaused");

  const full: Record<string, PublicKey> = {
    treasuryAuthority: authority.publicKey,
    treasury: treasuryPda,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  };

  const data = program.coder.instruction.encode("setTreasuryPaused", { paused });

  const keys = (ixDef.accounts as any[]).map((acc: any) => {
    const pubkey = full[acc.name];
    if (!pubkey) {
      throw new Error(
        `Missing account '${acc.name}' for setTreasuryPaused. Provided: ${Object.keys(full).join(", ")}`
      );
    }
    const { isSigner, isWritable } = accMetaFromIdl(acc);
    return { pubkey, isSigner, isWritable };
  });

  const ix = new anchor.web3.TransactionInstruction({
    programId: program.programId,
    keys,
    data,
  });

  const tx = new anchor.web3.Transaction().add(ix);
  const ap = program.provider as anchor.AnchorProvider;
  await ap.sendAndConfirm(tx, [authority]);
}

type PayAttemptOutcome =
  | { kind: "SUCCESS"; amount: number }
  | { kind: "REJECT_PAUSED"; amount: number }
  | { kind: "SKIPPED_RECEIPT_EXISTS"; amount: number };

async function splPayStrict(args: {
  program: Program<any>;
  authority: Keypair;
  treasuryPda: PublicKey;
  mint: PublicKey;
  recipient: PublicKey;
  amount: number;
  nonce: anchor.BN; // used only if nonce-mode; still required for determinism / rerun-skip
  pausedExpected: boolean;
}): Promise<PayAttemptOutcome> {
  const { program, authority, treasuryPda, mint, recipient, amount, nonce, pausedExpected } = args;

  const ixDef = getIx(program, "splPay");

  const treasuryAta = getAssociatedTokenAddressSync(mint, treasuryPda, true);
  const recipientAta = getAssociatedTokenAddressSync(mint, recipient, false);

  // 🔥 ADAPTIVE receipt derivation (nonce-mode vs payCount-mode)
  const { receipt } = await deriveReceiptPdaAdaptive({
    program,
    treasuryPda,
    nonceIfUsed: nonce,
  });

  // If receipt already exists, treat as SKIPPED (do NOT count amount).
  // This keeps invariants honest on reruns.
  const ap = program.provider as anchor.AnchorProvider;
  const receiptInfo = await ap.connection.getAccountInfo(receipt);
  if (receiptInfo) {
    return { kind: "SKIPPED_RECEIPT_EXISTS", amount };
  }

  const full: Record<string, PublicKey> = {
    treasuryAuthority: authority.publicKey,
    treasury: treasuryPda,
    mint,
    treasuryAta,
    recipient,
    recipientAta,
    receipt,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  };

  // Build args object based on IDL arg names (amount + nonce-like + memo-like)
  // If IDL has no nonce arg (payCount-mode), this will simply not include it.
  const argsObj: any = {};
  for (const a of ixDef.args as any[]) {
    const name = String(a.name);
    const lower = name.toLowerCase();
    if (name === "amount") argsObj[name] = bn(amount);
    else if (lower.includes("memo")) argsObj[name] = null;
    else if (lower.includes("nonce")) argsObj[name] = nonce;
    else argsObj[name] = null;
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

  const ix = new anchor.web3.TransactionInstruction({
    programId: program.programId,
    keys,
    data,
  });

  const tx = new anchor.web3.Transaction().add(ix);

  try {
    await ap.sendAndConfirm(tx, [authority]);
    if (pausedExpected) {
      // Governance breach: succeeded while paused
      throw new Error("Tier4 breach: splPay succeeded while treasury paused.");
    }
    return { kind: "SUCCESS", amount };
  } catch (e: any) {
    if (pausedExpected && isPauseError(e)) {
      return { kind: "REJECT_PAUSED", amount };
    }
    throw e;
  }
}

// ---------- SPEC ----------

describe("stress - Tier4 adversarial scheduler (SEEDed, STRICT)", () => {
  let program: Program<any>;
  let provider: anchor.AnchorProvider;

  let treasuryPda: PublicKey;
  let mint: PublicKey;
  let treasuryAtaPk: PublicKey;

  let protocolAuth: Keypair;

  // ---- knobs (env override) ----
  const SEED = Number(process.env.TIER4_SEED ?? "1337");
  const TOTAL_ATTEMPTS = Number(process.env.TIER4_ATTEMPTS ?? "220");

  const RECIPIENTS = Number(process.env.TIER4_RECIPIENTS ?? "12");

  const MIN_WINDOW = Number(process.env.TIER4_MIN_WINDOW ?? "8");
  const MAX_WINDOW = Number(process.env.TIER4_MAX_WINDOW ?? "24");

  const MIN_WORKERS = Number(process.env.TIER4_MIN_WORKERS ?? "1");
  const MAX_WORKERS = Number(process.env.TIER4_MAX_WORKERS ?? "10");

  const MIN_DELAY_MS = Number(process.env.TIER4_MIN_DELAY_MS ?? "0");
  const MAX_DELAY_MS = Number(process.env.TIER4_MAX_DELAY_MS ?? "180");

  const MIN_PAY = Number(process.env.TIER4_MIN_PAY ?? "1");
  const MAX_PAY = Number(process.env.TIER4_MAX_PAY ?? "250");

  const recipients: Keypair[] = [];

  // Deterministic nonce base (still used for replayability + rerun skip logic)
  const RUN_NONCE_BASE = new anchor.BN(NONCE_PAY_BASE).add(new anchor.BN(SEED).mul(new anchor.BN(1_000_000)));

  // receipt mode + pay mutex (initialized in before)
  let usesNonceMode = false;
  const payLock = createMutex();

  before(async () => {
    const envProvider = anchor.AnchorProvider.env();
    anchor.setProvider(envProvider);

    protocolAuth = loadProtocolAuthority();
    await airdrop(envProvider, protocolAuth.publicKey, 2);
    await sleep(120);

    // Provider bound to protocolAuth wallet (Tier3B discipline)
    provider = new anchor.AnchorProvider(envProvider.connection, new anchor.Wallet(protocolAuth), {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
      skipPreflight: false,
    });
    anchor.setProvider(provider);

    // Workspace program is cached; build a fresh Program bound to our provider
    // @ts-ignore
    const wsProgram = anchor.workspace.Protocol as Program<any>;

    const ctorArity = (Program as any).length;
    if (ctorArity >= 3) {
      program = new (Program as any)(wsProgram.idl, wsProgram.programId, provider);
    } else {
      const idl = wsProgram.idl as any;
      idl.metadata = { ...(idl.metadata ?? {}), address: wsProgram.programId.toBase58() };
      program = new (Program as any)(idl, provider);
    }

    const ap = program.provider as anchor.AnchorProvider;
    if (ap.wallet.publicKey.toBase58() !== protocolAuth.publicKey.toBase58()) {
      throw new Error("Provider wallet mismatch: Program not bound correctly.");
    }

    // Derive treasury PDA
    [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], program.programId);

    // Fresh mint for Tier4 (self-contained)
    mint = await createMint(
      provider.connection,
      protocolAuth, // payer
      protocolAuth.publicKey, // mint authority
      null,
      6
    );

    // Create treasury ATA for this mint
    treasuryAtaPk = getAssociatedTokenAddressSync(mint, treasuryPda, true);
    const treasuryAtaInfo = await provider.connection.getAccountInfo(treasuryAtaPk);
    if (!treasuryAtaInfo) {
      const ix = createAssociatedTokenAccountInstruction(
        protocolAuth.publicKey, // payer
        treasuryAtaPk,
        treasuryPda, // owner (PDA)
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      await withRetry(
        async () => {
          const tx = new anchor.web3.Transaction().add(ix);
          return provider.sendAndConfirm(tx, [protocolAuth], {
            commitment: "confirmed",
          });
        },
        { retries: 6, baseDelayMs: 250, label: "tier4-create-treasury-ata" }
      );
    }

    // Fund treasury ATA so splPay can never run dry
    await withRetry(
      () =>
        mintTo(provider.connection, protocolAuth, mint, treasuryAtaPk, protocolAuth.publicKey, 5_000_000),
      { retries: 6, baseDelayMs: 250, label: "tier4-mintTo" }
    );

    // Build recipients + fund ATA rent
    recipients.length = 0;
    for (let i = 0; i < RECIPIENTS; i++) recipients.push(Keypair.generate());

    await Promise.all(
      recipients.map(async (r) => {
        const sig = await provider.connection.requestAirdrop(
          r.publicKey,
          0.25 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(sig, "confirmed");
      })
    );

    // Ensure recipients ATAs
    await Promise.all(recipients.map((r) => ensureAtaExists(provider, r, mint)));

    // Normalize: start unpaused
    await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);

    // Decide receipt mode ONCE for this run (based on IDL)
    usesNonceMode = splPayHasNonceArg(program);
    // eslint-disable-next-line no-console
    console.log("Tier4 receipt mode:", usesNonceMode ? "nonce-mode" : "payCount-mode");
  });

  it("Tier4: seeded adversarial schedule preserves invariants", async () => {
    const rng = mulberry32(SEED);

    const treasuryBefore = await getAccount(provider.connection, treasuryAtaPk);

    const recipientAtas = recipients.map((r) => getAssociatedTokenAddressSync(mint, r.publicKey, false));
    const recipientsBefore = await Promise.all(recipientAtas.map((ata) => getAccount(provider.connection, ata)));

    const recipientSumBefore = recipientsBefore.reduce((acc, a) => acc + BigInt(a.amount.toString()), 0n);

    // Adversarial schedule state
    let paused = false;
    let windowRemaining = randInt(rng, MIN_WINDOW, MAX_WINDOW);

    // Counters
    let attemptsDone = 0;
    let successCount = 0;
    let rejectCount = 0;
    let skippedCount = 0;

    let sumSuccessfulPays = bn(0);

    while (attemptsDone < TOTAL_ATTEMPTS) {
      if (windowRemaining <= 0) {
        paused = !paused;
        windowRemaining = randInt(rng, MIN_WINDOW, MAX_WINDOW);

        await withRetry(
          () => setTreasuryPausedStrict(program, protocolAuth, treasuryPda, paused),
          { label: "setTreasuryPausedStrict" }
        );
      }

      const burstWorkers = randInt(rng, MIN_WORKERS, MAX_WORKERS);
      const burstSize = Math.min(burstWorkers, TOTAL_ATTEMPTS - attemptsDone);

      const tasks = Array.from({ length: burstSize }, (_, k) => async () => {
        // jitter
        const delay = randInt(rng, MIN_DELAY_MS, MAX_DELAY_MS);
        if (delay > 0) await sleep(delay);

        const attemptIndex = attemptsDone + k;
        const recipient = recipients[attemptIndex % recipients.length].publicKey;
        const amount = randInt(rng, MIN_PAY, MAX_PAY);

        // Deterministic nonce (used in nonce-mode, and still useful for rerun skip)
        const nonce = RUN_NONCE_BASE.add(new anchor.BN(attemptIndex + 1));

        // In payCount-mode we MUST serialize PAY, otherwise receipt seed collisions happen.
        const doPay = () =>
          withRetry(
            () =>
              splPayStrict({
                program,
                authority: protocolAuth,
                treasuryPda,
                mint,
                recipient,
                amount,
                nonce,
                pausedExpected: paused,
              }),
            { label: "splPayStrict" }
          );

        if (usesNonceMode) {
          return doPay();
        }

        // payCount-mode: serialize PAY critical section
        return payLock(doPay);
      });

      const results = await Promise.all(tasks.map((t) => t()));

      for (const r of results) {
        if (r.kind === "SUCCESS") {
          successCount++;
          sumSuccessfulPays = sumSuccessfulPays.add(bn(r.amount));
        } else if (r.kind === "REJECT_PAUSED") {
          rejectCount++;
        } else if (r.kind === "SKIPPED_RECEIPT_EXISTS") {
          skippedCount++;
        }
      }

      attemptsDone += burstSize;
      windowRemaining -= burstSize;
    }

    // Final balances
    const treasuryAfter = await getAccount(provider.connection, treasuryAtaPk);

    const recipientsAfter = await Promise.all(recipientAtas.map((ata) => getAccount(provider.connection, ata)));
    const recipientSumAfter = recipientsAfter.reduce((acc, a) => acc + BigInt(a.amount.toString()), 0n);

    const treasuryDelta = bn(treasuryBefore.amount.toString()).sub(bn(treasuryAfter.amount.toString()));
    const recipientAggregateDelta = bn((recipientSumAfter - recipientSumBefore).toString());

    // Evidence print
    console.log("Tier4 Evidence:", {
      seed: SEED,
      receiptMode: usesNonceMode ? "nonce-mode" : "payCount-mode",
      attemptsDone,
      successCount,
      rejectCount,
      skippedCount,
      sumSuccessfulPays: sumSuccessfulPays.toString(),
      treasuryDelta: treasuryDelta.toString(),
      recipientAggregateDelta: recipientAggregateDelta.toString(),
      pausedEndedAs: paused,
    });

    // Invariants
    expect(successCount).to.be.greaterThan(0);
    expect(rejectCount).to.be.greaterThan(0);

    expect(treasuryDelta.eq(sumSuccessfulPays), "treasuryDelta != sumSuccessfulPays").to.eq(true);
    expect(recipientAggregateDelta.eq(sumSuccessfulPays), "recipientAggregateDelta != sumSuccessfulPays").to.eq(true);
  });

  after(async () => {
    await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);
  });
});
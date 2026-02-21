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
} from "@solana/spl-token";
import { expect } from "chai";

import {
  loadProtocolAuthority,
  airdrop,
  withRetry,
  NONCE_PAY_BASE,
} from "./_helpers";

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

// Pay receipts: ["receipt", treasuryPda, nonce(u64LE)]
function payReceiptPda(programId: PublicKey, treasuryPda: PublicKey, nonce: anchor.BN) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), treasuryPda.toBuffer(), u64LE(nonce)],
    programId
  )[0];
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

async function splPayStrict(
  program: Program<any>,
  authority: Keypair,
  treasuryPda: PublicKey,
  mint: PublicKey,
  recipient: PublicKey,
  amount: number,
  nonce: anchor.BN,
  pausedExpected: boolean
): Promise<PayAttemptOutcome> {
  const ixDef = getIx(program, "splPay");

  const treasuryAta = getAssociatedTokenAddressSync(mint, treasuryPda, true);
  const recipientAta = getAssociatedTokenAddressSync(mint, recipient, false);
  const receipt = payReceiptPda(program.programId, treasuryPda, nonce);

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
  const argsObj: any = {};
  for (const a of ixDef.args as any[]) {
    const n = String(a.name);
    if (n === "amount") argsObj[n] = bn(amount);
    else if (n.toLowerCase().includes("memo")) argsObj[n] = null;
    else if (n.toLowerCase().includes("nonce")) argsObj[n] = nonce;
    else argsObj[n] = null;
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

  // Deterministic nonce base:
  // - uses NONCE_PAY_BASE namespace
  // - stable per SEED (replayable)
  //
  // If you always run against a fresh local validator per test, this is perfect.
  // If you sometimes rerun without reset, SKIPPED_RECEIPT_EXISTS keeps invariants correct.
  const RUN_NONCE_BASE = new anchor.BN(NONCE_PAY_BASE).add(new anchor.BN(SEED).mul(new anchor.BN(1_000_000)));

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

    // Discover treasury token account + mint (must already be funded)
    const tokenAccounts = await provider.connection.getTokenAccountsByOwner(treasuryPda, {
      programId: TOKEN_PROGRAM_ID,
    });
    if (!tokenAccounts.value.length) {
      throw new Error("Treasury PDA has no SPL token accounts (expected funded treasury).");
    }

    treasuryAtaPk = tokenAccounts.value[0].pubkey;
    const treasuryTokenAcc = await getAccount(provider.connection, treasuryAtaPk);
    mint = treasuryTokenAcc.mint;

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

      // fire burst with bounded concurrency (burstSize = concurrency here)
      const tasks = Array.from({ length: burstSize }, (_, k) => async () => {
        // jitter
        const delay = randInt(rng, MIN_DELAY_MS, MAX_DELAY_MS);
        if (delay > 0) await sleep(delay);

        const attemptIndex = attemptsDone + k;
        const recipient = recipients[attemptIndex % recipients.length].publicKey;
        const amount = randInt(rng, MIN_PAY, MAX_PAY);

        const nonce = RUN_NONCE_BASE.add(new anchor.BN(attemptIndex + 1));

        const outcome = await withRetry(
          () => splPayStrict(program, protocolAuth, treasuryPda, mint, recipient, amount, nonce, paused),
          {
            label: "splPayStrict",
            // default shouldRetry is good; it won't retry logical pause errors
          }
        );

        return outcome;
      });

      // Run them concurrently
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
    // We require at least some successes and some rejects for a meaningful run.
    expect(successCount).to.be.greaterThan(0);
    expect(rejectCount).to.be.greaterThan(0);

    expect(treasuryDelta.eq(sumSuccessfulPays), "treasuryDelta != sumSuccessfulPays").to.eq(true);
    expect(recipientAggregateDelta.eq(sumSuccessfulPays), "recipientAggregateDelta != sumSuccessfulPays").to.eq(true);
  });

after(async () => {
  await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);
});

});
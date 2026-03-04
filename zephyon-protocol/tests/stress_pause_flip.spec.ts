/**
 * Tier1 Stress Suite
 * - Validates pause gating under concurrent load
 * - Validates splPay interleaved with pause flips
 * - Ensures treasury delta integrity
 * - Prevents ATA race conditions via precreation
 *
 * NOTE (post-v0.31.x):
 * splPay receipts are pay_count-based:
 *   seeds = ["receipt", treasuryPda, pay_count_before(u64LE)]
 * So stress tests must derive receipt PDA from treasury.payCount (NOT nonce),
 * and under concurrency they MUST retry on receipt seed collisions.
 */

// tests/stress_pause_flip.spec.ts
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  mintTo,
} from "@solana/spl-token";

import {
  getProgram,
  initFoundationOnce,
  setupMintAndAtas,
  airdrop,
  BN,
  expect,
  loadProtocolAuthority,
} from "./_helpers";

/* -----------------------------
 * tiny utilities
 * ----------------------------- */
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTx(
  connection: anchor.web3.Connection,
  sig: string,
  finality: anchor.web3.Finality = "confirmed",
  maxMs = 25_000,
  pollMs = 600
) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const tx = await connection.getTransaction(sig, {
      commitment: finality,
      maxSupportedTransactionVersion: 0,
    });
    if (tx) return tx;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

// Bounded concurrency runner (no deps)
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

function isAccountInUseLike(err: any) {
  const s = String(err?.message ?? err);
  return (
    s.includes("AccountInUse") ||
    s.includes("already in use") ||
    s.includes("account in use") ||
    s.includes("Allocate: account")
  );
}

function isConstraintSeedsLike(err: any) {
  const s = String(err?.message ?? err).toLowerCase();
  return (
    s.includes("constraintseeds") ||
    s.includes("2006") ||
    s.includes("seed constraint") ||
    s.includes("seeds constraint")
  );
}

function isPausedLike(msgOrLogs: string) {
  const s = msgOrLogs.toLowerCase();
  return (
    s.includes("protocollpaused") ||
    s.includes("protocolpaused") ||
    s.includes("treasurypaused") ||
    s.includes("paused")
  );
}

function isRetryable(err: any) {
  const s = String(err?.message ?? err);
  return (
    isAccountInUseLike(err) ||
    isConstraintSeedsLike(err) ||
    s.includes("Blockhash not found") ||
    s.includes("Transaction was not confirmed") ||
    s.includes("Node is behind") ||
    s.includes("429") ||
    s.toLowerCase().includes("timeout")
  );
}

async function withRetry<T>(fn: () => Promise<T>, tries = 10, delayMs = 160) {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e)) throw e;
      await sleep(delayMs + i * 60);
    }
  }
  throw lastErr;
}

function u64LE(n: anchor.BN): Buffer {
  return n.toArrayLike(Buffer, "le", 8);
}

// Pay receipt PDA: ["receipt", treasuryPda, payCountBefore(u64LE)]
function payReceiptPda(
  programId: PublicKey,
  treasuryPda: PublicKey,
  payCountBefore: anchor.BN
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), treasuryPda.toBuffer(), u64LE(payCountBefore)],
    programId
  );
  return pda;
}

async function fetchPayCount(programAny: any, treasuryPda: PublicKey): Promise<anchor.BN> {
  const treasuryAcc: any = await programAny.account.treasury.fetch(treasuryPda);
  return new BN(treasuryAcc.payCount);
}

/**
 * Raw tx sender for pause flips.
 * Avoids Anchor error translation + helps prevent weirdness under load.
 */
async function sendSetPausedRaw(
  programAny: any,
  provider: anchor.AnchorProvider,
  treasuryPda: PublicKey,
  authority: Keypair,
  paused: boolean
): Promise<string> {
  const latest = await provider.connection.getLatestBlockhash("confirmed");

  const methodFn =
    programAny.methods?.setTreasuryPaused ??
    programAny.methods?.["set_treasury_paused"];

  if (!methodFn) {
    const keys = Object.keys(programAny.methods ?? {});
    throw new Error(
      `Pause method missing. Expected methods.setTreasuryPaused or methods["set_treasury_paused"]. Found: ${keys.join(
        ", "
      )}`
    );
  }

  const tx = await methodFn(paused)
    .accounts({
      treasury: treasuryPda,
      treasuryAuthority: authority.publicKey,
    } as any)
    .transaction();

  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(authority);

  const sig = await provider.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });

  await provider.connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed"
  );

  const info = await waitForTx(provider.connection, sig, "confirmed", 25_000, 700);
  if (!info) {
    const st = await provider.connection.getSignatureStatus(sig, {
      searchTransactionHistory: true,
    });
    throw new Error(
      `getTransaction returned null for pause tx ${sig} (status=${JSON.stringify(st?.value)})`
    );
  }

  if (info.meta?.err) {
    console.log("PAUSE TX FAILED SIG:", sig);
    console.log("LOGS:\n", (info.meta.logMessages ?? []).join("\n"));
    throw new Error(`pause tx failed: ${JSON.stringify(info.meta.err)}`);
  }

  return sig;
}

/**
 * Canonical splPay sender used inside pause flip stress.
 *
 * Behavior contract:
 * - Returns ok=true on successful pay.
 * - Returns ok=false with paused=true when rejected due to pause.
 * - Retries on receipt collisions (ConstraintSeeds/AccountInUse) by refetching pay_count.
 */
async function sendSplPayPayCountSafe(
  programAny: any,
  provider: anchor.AnchorProvider,
  signer: Keypair,
  args: {
    treasuryPda: PublicKey;
    mint: PublicKey;
    treasuryAta: PublicKey;
    recipient: PublicKey;
    recipientAta: PublicKey;
    amount: number;
  }
): Promise<{ sig: string; logs: string[]; ok: boolean; paused?: boolean; err?: any }> {
  const MAX_RETRIES = 14;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const latest = await provider.connection.getLatestBlockhash("confirmed");

    // Derive receipt PDA from fresh pay_count_before
    const payCountBefore = await fetchPayCount(programAny, args.treasuryPda);
    const receiptPda = payReceiptPda(
      programAny.programId,
      args.treasuryPda,
      payCountBefore
    );

    try {
      const tx = await programAny.methods
        // ✅ Canon: splPay(amount, reference, memo)
        .splPay(new BN(args.amount), null, null)
        .accounts({
          treasuryAuthority: signer.publicKey,
          recipient: args.recipient,
          treasury: args.treasuryPda,
          mint: args.mint,
          recipientAta: args.recipientAta,
          treasuryAta: args.treasuryAta,
          receipt: receiptPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .transaction();

      tx.feePayer = signer.publicKey;
      tx.recentBlockhash = latest.blockhash;
      tx.sign(signer);

      const sig = await provider.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      });

      await provider.connection.confirmTransaction(
        {
          signature: sig,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        "confirmed"
      );

      const info = await waitForTx(provider.connection, sig, "confirmed", 25_000, 650);
      const logs = info?.meta?.logMessages ?? [];
      const ok = !info?.meta?.err;

      if (ok) return { sig, logs, ok: true };

      const joined = logs.join("\n");
      if (isPausedLike(joined) || isPausedLike(String(info?.meta?.err ?? ""))) {
        return { sig, logs, ok: false, paused: true, err: info?.meta?.err };
      }

      // Collision / ordering race — retry by refetching pay_count
      if (
        joined.toLowerCase().includes("constraintseeds") ||
        joined.includes("2006") ||
        joined.toLowerCase().includes("accountinuse") ||
        joined.toLowerCase().includes("already in use")
      ) {
        await sleep(40 * attempt);
        continue;
      }

      return { sig, logs, ok: false, err: info?.meta?.err };
    } catch (e: any) {
      const msg = String(e?.message ?? e);

      // If pause bubbled up as a thrown error (rare in raw path), treat as expected reject
      if (isPausedLike(msg)) {
        return { sig: "thrown", logs: [msg], ok: false, paused: true, err: e };
      }

      // Collision / transient — retry
      if ((isConstraintSeedsLike(e) || isAccountInUseLike(e) || isRetryable(e)) && attempt < MAX_RETRIES) {
        await sleep(60 * attempt);
        continue;
      }

      throw e;
    }
  }

  return {
    sig: "exhausted",
    logs: [],
    ok: false,
    err: new Error("sendSplPayPayCountSafe exhausted retries"),
  };
}

describe("stress - pause flip under load (Tier1-A)", function () {
  this.timeout(1_000_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = getProgram();
  const programAny = program as any;

  // Always use a real Keypair signer
  const realProtocolAuth = loadProtocolAuthority();

  it("pays interleaved with pause flips; rejects while paused; resumes cleanly", async () => {
    // knobs
    const PAY_COUNT = 300;
    const CONCURRENCY = 5;
    const PAY_AMOUNT = 1;

    const FLIPS = 30;
    const FLIP_DELAY_MS = 150;

    // init foundation + treasury PDA
    const { treasuryPda } = await initFoundationOnce(
      provider as AnchorProvider,
      program as any
    );

    // fees for protocol authority + recipients
    await airdrop(provider, realProtocolAuth.publicKey, 2);

    // mint + treasury ATA (owned by treasury PDA)
    const { mint, treasuryAta } = await setupMintAndAtas(
      provider as AnchorProvider,
      realProtocolAuth,
      treasuryPda,
      0n
    );

    // fund treasury ATA with enough tokens for success cases
    await withRetry(async () => {
      await mintTo(
        provider.connection,
        realProtocolAuth,
        mint,
        treasuryAta.address,
        realProtocolAuth.publicKey,
        PAY_COUNT + 700
      );
    });

    // recipients (small set reused)
    const recipients: Keypair[] = Array.from({ length: 25 }, () => Keypair.generate());

    // precreate recipient ATAs (Tier1 doctrine: remove ATA creation races)
    const recipientAtas = new Map<string, PublicKey>();
    for (const r of recipients) {
      await airdrop(provider, r.publicKey, 1);
      const ata = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        realProtocolAuth, // payer
        mint,
        r.publicKey
      );
      recipientAtas.set(r.publicKey.toBase58(), ata.address);
    }

    // snapshot before
    const before = await getAccount(provider.connection, treasuryAta.address);
    const beforeAmt = Number(before.amount);

    let allowedPays = 0;
    let rejectedPays = 0;

    try {
      const flipper = (async () => {
        for (let i = 0; i < FLIPS; i++) {
          await withRetry(() =>
            sendSetPausedRaw(programAny, provider as any, treasuryPda, realProtocolAuth, true)
          );
          await sleep(FLIP_DELAY_MS);

          await withRetry(() =>
            sendSetPausedRaw(programAny, provider as any, treasuryPda, realProtocolAuth, false)
          );
          await sleep(FLIP_DELAY_MS);
        }
      })();

      const payStorm = (async () => {
        const jobs = Array.from({ length: PAY_COUNT }, (_, i) => i);

        await runBounded(jobs, CONCURRENCY, async (i) => {
          const recipient = recipients[i % recipients.length];

          const recipientAta =
            recipientAtas.get(recipient.publicKey.toBase58()) ??
            getAssociatedTokenAddressSync(
              mint,
              recipient.publicKey,
              false,
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            );

          const result = await sendSplPayPayCountSafe(programAny, provider as any, realProtocolAuth, {
            treasuryPda,
            mint,
            treasuryAta: treasuryAta.address,
            recipient: recipient.publicKey,
            recipientAta,
            amount: PAY_AMOUNT,
          });

          if (result.ok) {
            allowedPays++;
            return;
          }

          if (result.paused) {
            rejectedPays++;
            return;
          }

          // Not pause-related => real failure: print forensic payload
          const joined = (result.logs ?? []).join("\n");
          console.log("SPLPAY FAILED SIG:", result.sig);
          console.log("LOGS:\n", joined);
          throw new Error(`splPay failed: ${JSON.stringify(result.err)}`);
        });
      })();

      await Promise.all([flipper, payStorm]);
    } finally {
      // hard guarantee: unpause at the end (prevents poisoning other tests)
      await withRetry(
        () => sendSetPausedRaw(programAny, provider as any, treasuryPda, realProtocolAuth, false),
        8,
        160
      );
    }

    // snapshot after
    const after = await getAccount(provider.connection, treasuryAta.address);
    const afterAmt = Number(after.amount);

    const delta = beforeAmt - afterAmt;

    // assertions
   expect(rejectedPays).to.be.greaterThan(0);
expect(allowedPays).to.be.greaterThan(0);
expect(allowedPays).to.be.lessThan(PAY_COUNT); // not “everything passed”
expect(allowedPays).to.be.at.most(Math.floor(PAY_COUNT * 0.35)); // chaos should reject most
expect(delta).to.eq(allowedPays * PAY_AMOUNT);

    console.log({
      PAY_COUNT,
      CONCURRENCY,
      FLIPS,
      allowedPays,
      rejectedPays,
      treasuryBefore: beforeAmt,
      treasuryAfter: afterAmt,
      delta,
    });
  });
});







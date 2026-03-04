/**
 * Tier2 — Interleaved Chaos (Layer2A: PAY + PAUSE)
 *
 * Canonical (post-v0.31.x):
 * - splPay receipts are pay_count-based:
 *   seeds = ["receipt", treasuryPda, pay_count_before(u64LE)]
 *
 * Implications:
 * - PAY is a single-writer critical section (payCount-based receipt init).
 *   If two PAY txs read payCount simultaneously, they derive the same receipt PDA -> collision.
 *
 * Strategy (deterministic + audit-grade):
 * - Run multiple "cycles" concurrently.
 * - Each cycle performs:
 *     1) unpause
 *     2) PAY (must succeed)
 *     3) pause
 *     4) PAY (must reject)
 *     5) unpause (poison prevention)
 * - We serialize the PAUSE→PAY pairing so no other worker can flip pause state
 *   between "set paused" and "send pay".
 *
 * Invariant:
 * - treasuryDelta == recipientDelta  (only successful pays move value)
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import * as fs from "fs";

import {
  loadProtocolAuthority,
  initFoundationOnce,
  setupMintAndAtas,
  airdrop,
} from "./_helpers";

/* -----------------------------
 * tiny utilities
 * ----------------------------- */
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
  const msg = String(e?.message ?? e);
  return (
    msg.includes("ProtocolPaused") ||
    msg.includes("TreasuryPaused") ||
    msg.toLowerCase().includes("paused")
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

      // never retry expected pause gating errors
      if (isPausedLike(e)) throw e;
      if (!isRetryable(e)) throw e;

      await sleep(baseDelayMs + i * 40);
    }
  }
  throw new Error(
    `withRetry exhausted (${label}): ${String(lastErr?.message ?? lastErr)}`
  );
}

/* -----------------------------
 * Raw tx sender (avoids .rpc() landmines)
 * ----------------------------- */
async function sendRaw(
  provider: AnchorProvider,
  tx: Transaction,
  signers: Keypair[]
): Promise<string> {
  const feePayer = signers[0]?.publicKey ?? (provider.wallet as any).publicKey;
  tx.feePayer = feePayer;

  const bh = await provider.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = bh.blockhash;

  tx.sign(...signers);

  const sig = await provider.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  await provider.connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/**
 * Pause method picker (IDL-adaptive)
 */
function pickPauseMethod(programAny: any): ((paused: boolean) => any) {
  const m = programAny?.methods;
  const candidates = [
    "setTreasuryPaused",
    "set_treasury_paused",
    "setPause",
    "setPaused",
    "pause",
    "togglePause",
  ];

  for (const name of candidates) {
    if (typeof m?.[name] === "function")
      return (paused: boolean) => m[name](paused);
  }

  const keys = Object.keys(m ?? {});
  throw new Error(
    `No pause method found. Tried: ${candidates.join(", ")}. Available: ${keys.join(
      ", "
    )}`
  );
}

async function sendPauseRaw(args: {
  provider: AnchorProvider;
  pauseFn: (paused: boolean) => any;
  treasuryPda: PublicKey;
  authority: Keypair;
  paused: boolean;
}): Promise<void> {
  const { provider, pauseFn, treasuryPda, authority, paused } = args;

  const tx = await pauseFn(paused)
    .accounts({
      treasury: treasuryPda,
      treasuryAuthority: authority.publicKey,
    } as any)
    .transaction();

  await sendRaw(provider, tx, [authority]);
}

/**
 * PAY sender (canonical: payCount-based receipt PDA derived on-chain)
 * Note: current Rust signature is 3 args: (amount, memo?, reference?)
 */
async function sendSplPayRaw(args: {
  provider: AnchorProvider;
  programAny: any;
  treasuryPda: PublicKey;
  treasuryAta: PublicKey;
  mint: PublicKey;
  recipient: PublicKey;
  recipientAta: PublicKey;
  authority: Keypair;
  amount: number;
}): Promise<void> {
  const { provider, programAny } = args;

  const tx = await programAny.methods
    .splPay(new BN(args.amount), null, null)
    .accounts({
      treasuryAuthority: args.authority.publicKey,
      recipient: args.recipient,
      treasury: args.treasuryPda,
      mint: args.mint,
      recipientAta: args.recipientAta,
      treasuryAta: args.treasuryAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .transaction();

  await sendRaw(provider, tx, [args.authority]);
}

/**
 * Simple async mutex
 */
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
 * SPEC
 * ----------------------------- */

describe("stress - Tier2 interleaved chaos", () => {
  const protocolAuth: Keypair = loadProtocolAuthority();

  const envProvider = AnchorProvider.env();
  const authorityProvider = new AnchorProvider(
    envProvider.connection,
    new anchor.Wallet(protocolAuth),
    envProvider.opts
  );

  anchor.setProvider(authorityProvider);

  // Tripwire
  assertProviderIsAuthority(authorityProvider, protocolAuth.publicKey);

  // Load IDL at runtime (avoid tsgen drift)
  const idlPath = "target/idl/protocol.json";
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const programAny = new anchor.Program(idl as any, authorityProvider) as any;
  const programId = new PublicKey(idl.address);

  let treasuryPda: PublicKey;
  let mint: PublicKey;
  let treasuryAta: PublicKey;

  const recipient = Keypair.generate();
  let recipientAta: PublicKey;

  before(async () => {
    await airdrop(authorityProvider, protocolAuth.publicKey, 2);
    await airdrop(authorityProvider, recipient.publicKey, 2);

    [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      programId
    );

    // idempotent init
    await initFoundationOnce(authorityProvider, programAny);

    // mint + ATAs
    const setup = await setupMintAndAtas(
      authorityProvider,
      protocolAuth,
      treasuryPda,
      1_000_000n
    );
    mint = setup.mint;
    treasuryAta = setup.treasuryAta.address;

    // recipient ATA (payer = protocolAuth)
    const rAta = await getOrCreateAssociatedTokenAccount(
      authorityProvider.connection,
      protocolAuth,
      mint,
      recipient.publicKey
    );
    recipientAta = rAta.address;

    // fund treasury for pay stream
    await mintTo(
      authorityProvider.connection,
      protocolAuth,
      mint,
      treasuryAta,
      protocolAuth.publicKey,
      5_000_000
    );

    const t = await getAccount(authorityProvider.connection, treasuryAta);
    console.log("Tier2A treasury funded:", t.amount.toString());
  });

  it("Layer2A: interleaves PAY + PAUSE without invariant drift (deterministic)", async () => {
    const pauseFn = pickPauseMethod(programAny);

    // Always start unpaused
    await withRetry(
      async () => {
        await sendPauseRaw({
          provider: authorityProvider,
          pauseFn,
          treasuryPda,
          authority: protocolAuth,
          paused: false,
        });
      },
      "unpause-start",
      8
    );

    const treasuryBefore = await getAccount(authorityProvider.connection, treasuryAta);
    const recipientBefore = await getAccount(authorityProvider.connection, recipientAta);

    // knobs
    const CYCLES = Number(process.env.TIER2A_CYCLES ?? "20");
    const CONCURRENCY = Number(process.env.TIER2A_CONCURRENCY ?? "5");

    // Counters
    let pauseSets = 0;
    let successPays = 0;
    let rejectedPays = 0;

    let sumSuccessful = 0n;

    // One lock to protect "pause->pay" pairing + payCount single-writer property
    const stateLock = createMutex();

    // Build work items
    const cycles = Array.from({ length: CYCLES }, (_, i) => i);

    await runBounded(cycles, CONCURRENCY, async (cycleIdx) => {
      await withRetry(
        async () => {
          assertProviderIsAuthority(authorityProvider, protocolAuth.publicKey);

          // jitter to create interleaving between workers (realistic)
          // (kept small so test stays fast, but adds schedule variability)
          await sleep((cycleIdx % 5) * 10);

          // Serialize the critical governance+pay sequence
          await stateLock(async () => {
            // 1) unpause
            await sendPauseRaw({
              provider: authorityProvider,
              pauseFn,
              treasuryPda,
              authority: protocolAuth,
              paused: false,
            });
            pauseSets++;

            // 2) PAY (must succeed)
            const amountOk = 111 + cycleIdx;
            await sendSplPayRaw({
              provider: authorityProvider,
              programAny,
              treasuryPda,
              treasuryAta,
              mint,
              recipient: recipient.publicKey,
              recipientAta,
              authority: protocolAuth,
              amount: amountOk,
            });
            successPays++;
            sumSuccessful += BigInt(amountOk);

            // 3) pause
            await sendPauseRaw({
              provider: authorityProvider,
              pauseFn,
              treasuryPda,
              authority: protocolAuth,
              paused: true,
            });
            pauseSets++;

            // 4) PAY (must reject)
            const amountReject = 222 + cycleIdx;
            try {
              await sendSplPayRaw({
                provider: authorityProvider,
                programAny,
                treasuryPda,
                treasuryAta,
                mint,
                recipient: recipient.publicKey,
                recipientAta,
                authority: protocolAuth,
                amount: amountReject,
              });

              // If we got here, governance was violated
              throw new Error(
                `Governance breach: PAY succeeded while paused (cycle=${cycleIdx})`
              );
            } catch (e: any) {
              if (isPausedLike(e)) {
                rejectedPays++;
              } else {
                throw e;
              }
            }

            // 5) unpause (poison prevention)
            await sendPauseRaw({
              provider: authorityProvider,
              pauseFn,
              treasuryPda,
              authority: protocolAuth,
              paused: false,
            });
            pauseSets++;
          });
        },
        `cycle-${cycleIdx}`,
        10
      );
    });

    // Always end unpaused
    await withRetry(
      async () => {
        await sendPauseRaw({
          provider: authorityProvider,
          pauseFn,
          treasuryPda,
          authority: protocolAuth,
          paused: false,
        });
      },
      "unpause-end",
      8
    );

    const treasuryAfter = await getAccount(authorityProvider.connection, treasuryAta);
    const recipientAfter = await getAccount(authorityProvider.connection, recipientAta);

    const treasuryDelta = treasuryBefore.amount - treasuryAfter.amount; // bigint
    const recipientDelta = recipientAfter.amount - recipientBefore.amount; // bigint

    console.log({
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

    // Signal requirements
    expect(pauseSets).to.be.greaterThan(0);
    expect(successPays).to.be.greaterThan(0);
    expect(rejectedPays).to.be.greaterThan(0);

    // Audit-grade invariant
    expect(treasuryDelta).to.eq(recipientDelta);

    // Optional debug tripwire (should match under this deterministic design)
    expect(treasuryDelta).to.eq(sumSuccessful);
  });
});




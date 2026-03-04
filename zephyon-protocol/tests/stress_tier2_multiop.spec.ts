/**
 * Tier2 — Multi-Op Interleaved Chaos (Layer2B: PAY + WITHDRAW + PAUSE)
 *
 * Canonical (post-v0.31.x):
 * - splPay receipts are pay_count-based:
 *   seeds = ["receipt", treasuryPda, pay_count_before(u64LE)]
 *
 * Hardening:
 * - Provider locked to protocolAuth (no wallet drift).
 * - Program constructed from runtime IDL (tsgen drift-proof).
 * - PAY steps serialized (mutex) to prevent pay_count receipt collisions.
 * - splPay + withdraw sent via raw tx to avoid AnchorProvider.sendAndConfirm brittleness.
 * - Pause-related preflight simulation failures are counted as rejections (expected).
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import * as fs from "fs";

import {
  loadProtocolAuthority,
  initFoundationOnce,
  setupMintAndAtas,
  airdrop,
  expect,
} from "./_helpers";

/* -----------------------------
 * types + tiny utilities
 * ----------------------------- */
type Step =
  | { kind: "PAUSE"; paused: boolean; tag: string }
  | { kind: "PAY"; amount: number; tag: string }
  | { kind: "WITHDRAW"; amount: number; tag: string };

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

// runBounded(items, limit, worker)
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
    s.toLowerCase().includes("timeout")
  );
}

function isPausedLikeText(s: string) {
  const t = s.toLowerCase();
  return (
    t.includes("protocolpaused") ||
    t.includes("treasurypaused") ||
    t.includes("protocol is paused") ||
    t.includes("paused")
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

      const msg = String(e?.message ?? e);
      if (isPausedLikeText(msg)) throw e; // expected gating, don't retry

      if (!isRetryable(e)) throw e;
      await sleep(baseDelayMs + i * 40);
    }
  }
  throw new Error(
    `withRetry exhausted (${label}): ${String(lastErr?.message ?? lastErr)}`
  );
}

function u64LE(n: BN): Buffer {
  return n.toArrayLike(Buffer, "le", 8);
}

// Receipt PDA: ["receipt", treasuryPda, payCountBefore(u64LE)]
function receiptPdaPayCount(
  programId: PublicKey,
  treasuryPda: PublicKey,
  payCountBefore: BN
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), treasuryPda.toBuffer(), u64LE(payCountBefore)],
    programId
  );
  return pda;
}

// Pause method picker (IDL-adaptive)
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
    if (typeof m?.[name] === "function") return (paused: boolean) => m[name](paused);
  }

  const keys = Object.keys(m ?? {});
  throw new Error(
    `No pause method found. Tried: ${candidates.join(", ")}. Available: ${keys.join(", ")}`
  );
}

// Async mutex to serialize PAY critical section
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
 * raw tx senders
 * ----------------------------- */

// splPay raw sender (payCount-based receipt). Returns ok=false for paused preflight or paused meta.err.
async function sendSplPayRawPayCount(args: {
  programAny: any;
  provider: AnchorProvider;
  authority: Keypair;
  treasuryPda: PublicKey;
  treasuryAta: PublicKey;
  mint: PublicKey;
  recipient: PublicKey;
  recipientAta: PublicKey;
  amount: number;
}): Promise<{ ok: boolean; sig: string; logs: string[]; err?: any }> {
  const latest = await args.provider.connection.getLatestBlockhash("confirmed");

  // Fetch payCountBefore (canonical receipt derivation)
  const treasuryAcc: any = await args.programAny.account.treasury.fetch(args.treasuryPda);
  const payCountBefore = new BN(treasuryAcc.payCount);

  const receipt = receiptPdaPayCount(args.programAny.programId, args.treasuryPda, payCountBefore);

  const tx = await args.programAny.methods
    .splPay(new BN(args.amount), null, null) // ✅ current rust: 3 args
    .accounts({
      treasuryAuthority: args.authority.publicKey,
      recipient: args.recipient,
      treasury: args.treasuryPda,
      mint: args.mint,
      recipientAta: args.recipientAta,
      treasuryAta: args.treasuryAta,
      receipt,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .transaction();

  tx.feePayer = args.authority.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(args.authority);

  let sig = "";
  try {
    sig = await args.provider.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const logs = (typeof e?.getLogs === "function" ? await e.getLogs() : []) as string[];
    const joined = [msg, ...logs].join("\n");
    if (isPausedLikeText(joined)) {
      return { ok: false, sig: "preflight-rejected", logs, err: e };
    }
    throw e;
  }

  await args.provider.connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed"
  );

  const info = await args.provider.connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  const logs = info?.meta?.logMessages ?? [];
  const ok = !info?.meta?.err;

  if (!ok) {
    const joined = logs.join("\n");
    if (isPausedLikeText(joined)) return { ok: false, sig, logs, err: info?.meta?.err };
  }

  return { ok, sig, logs, err: info?.meta?.err };
}

// withdraw raw sender (build tx via .transaction() to avoid provider “action undefined” failures)
async function sendWithdrawRaw(args: {
  programAny: any;
  provider: AnchorProvider;
  authority: Keypair;
  amount: number;
  accounts: Record<string, any>;
}): Promise<{ ok: boolean; sig: string; logs: string[]; err?: any }> {
  const latest = await args.provider.connection.getLatestBlockhash("confirmed");

  const tx = await args.programAny.methods
    .splWithdraw(new BN(args.amount))
    .accounts(args.accounts as any)
    .transaction();

  tx.feePayer = args.authority.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(args.authority);

  let sig = "";
  try {
    sig = await args.provider.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const logs = (typeof e?.getLogs === "function" ? await e.getLogs() : []) as string[];
    const joined = [msg, ...logs].join("\n");
    if (isPausedLikeText(joined)) {
      return { ok: false, sig: "preflight-rejected", logs, err: e };
    }
    throw e;
  }

  await args.provider.connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed"
  );

  const info = await args.provider.connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  const logs = info?.meta?.logMessages ?? [];
  const ok = !info?.meta?.err;

  if (!ok) {
    const joined = logs.join("\n");
    if (isPausedLikeText(joined)) return { ok: false, sig, logs, err: info?.meta?.err };
  }

  return { ok, sig, logs, err: info?.meta?.err };
}

/* -----------------------------
 * test
 * ----------------------------- */

describe("stress - Tier2 multiop interleaved chaos (Layer2B)", () => {
  const protocolAuth: Keypair = loadProtocolAuthority();

  const envProvider = AnchorProvider.env();
  const authorityProvider = new AnchorProvider(
    envProvider.connection,
    new anchor.Wallet(protocolAuth),
    envProvider.opts
  );

  anchor.setProvider(authorityProvider);
  assertProviderIsAuthority(authorityProvider, protocolAuth.publicKey);

  // Load IDL runtime
  const idlPath = "target/idl/protocol.json";
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const programAny = new anchor.Program(idl as any, authorityProvider) as any;
  const programId = new PublicKey(idl.address);

  let treasuryPda: PublicKey;
  let mint: PublicKey;
  let treasuryAta: PublicKey;

  const recipient = Keypair.generate();
  let recipientAta: PublicKey;

  let authUserAta: PublicKey; // withdraw destination

  before(async () => {
    await airdrop(authorityProvider, protocolAuth.publicKey, 2);
    await airdrop(authorityProvider, recipient.publicKey, 2);

    [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], programId);

    await initFoundationOnce(authorityProvider, programAny);

    const setup = await setupMintAndAtas(authorityProvider, protocolAuth, treasuryPda, 1_000_000n);
    mint = setup.mint;
    treasuryAta = setup.treasuryAta.address;

    const rAta = await getOrCreateAssociatedTokenAccount(
      authorityProvider.connection,
      protocolAuth,
      mint,
      recipient.publicKey
    );
    recipientAta = rAta.address;

    const uAta = await getOrCreateAssociatedTokenAccount(
      authorityProvider.connection,
      protocolAuth,
      mint,
      protocolAuth.publicKey
    );
    authUserAta = uAta.address;

    await mintTo(
      authorityProvider.connection,
      protocolAuth,
      mint,
      treasuryAta,
      protocolAuth.publicKey,
      10_000_000
    );
  });

  it("Layer2B: interleaves PAY + WITHDRAW + PAUSE without invariant drift", async () => {
    const CONCURRENCY = 4; // keep signal stable
    const pauseFn = pickPauseMethod(programAny);

    const pauseAccounts = {
      treasury: treasuryPda,
      treasuryAuthority: protocolAuth.publicKey,
    };

    const withdrawAccounts = {
      treasuryAuthority: protocolAuth.publicKey,
      user: protocolAuth.publicKey,
      treasury: treasuryPda,
      mint,
      userAta: authUserAta,
      treasuryAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    };

    // Ensure not paused at start
    await withRetry(
      async () => {
        await pauseFn(false)
          .accounts(pauseAccounts as any)
          .signers([protocolAuth])
          .rpc();
      },
      "unpause-start",
      6
    );

    // Snapshot before
    const tBefore = await getAccount(authorityProvider.connection, treasuryAta);
    const rBefore = await getAccount(authorityProvider.connection, recipientAta);
    const uBefore = await getAccount(authorityProvider.connection, authUserAta);

    const treasuryBefore = Number(tBefore.amount);
    const recipientBefore = Number(rBefore.amount);
    const userBefore = Number(uBefore.amount);

    // Windowed plan (guarantee both successes + rejections)
    const steps: Step[] = [];

    // Open window (successes)
    for (let i = 0; i < 8; i++) steps.push({ kind: "PAY", amount: 30 + i, tag: `warm-pay-${i}` });
    for (let i = 0; i < 3; i++) steps.push({ kind: "WITHDRAW", amount: 12 + i, tag: `warm-withdraw-${i}` });

    // Paused window (rejections)
    steps.push({ kind: "PAUSE", paused: true, tag: "pause-on-1" });
    for (let i = 0; i < 8; i++) steps.push({ kind: "PAY", amount: 40 + i, tag: `paused-pay-${i}` });
    for (let i = 0; i < 3; i++) steps.push({ kind: "WITHDRAW", amount: 15 + i, tag: `paused-withdraw-${i}` });

    // Open window again (successes)
    steps.push({ kind: "PAUSE", paused: false, tag: "pause-off-1" });
    for (let i = 0; i < 8; i++) steps.push({ kind: "PAY", amount: 55 + i, tag: `open2-pay-${i}` });
    for (let i = 0; i < 3; i++) steps.push({ kind: "WITHDRAW", amount: 18 + i, tag: `open2-withdraw-${i}` });

    // End unpaused (poison prevention)
    steps.push({ kind: "PAUSE", paused: false, tag: "final-unpause" });

    // Counters + sums
    let pauseSets = 0;

    let successPays = 0;
    let rejectedPays = 0;
    let sumPays = 0;

    let successWithdraws = 0;
    let rejectedWithdraws = 0;
    let sumWithdraws = 0;

    const payLock = createMutex();

    try {
      await runBounded(steps, CONCURRENCY, async (step, idx) => {
        await withRetry(
          async () => {
            assertProviderIsAuthority(authorityProvider, protocolAuth.publicKey);

            if (step.kind === "PAUSE") {
              await pauseFn(step.paused)
                .accounts(pauseAccounts as any)
                .signers([protocolAuth])
                .rpc();
              pauseSets++;
              return;
            }

            if (step.kind === "PAY") {
              await payLock(async () => {
                const res = await sendSplPayRawPayCount({
                  programAny,
                  provider: authorityProvider,
                  authority: protocolAuth,
                  treasuryPda,
                  treasuryAta,
                  mint,
                  recipient: recipient.publicKey,
                  recipientAta,
                  amount: step.amount,
                });

                if (res.ok) {
                  successPays++;
                  sumPays += step.amount;
                  return;
                }

                const joined = (res.logs ?? []).join("\n");
                if (isPausedLikeText(joined)) {
                  rejectedPays++;
                  return;
                }

                console.log("splPay failed sig:", res.sig);
                console.log("logs:\n", (res.logs ?? []).join("\n"));
                throw new Error(`splPay failed: ${JSON.stringify(res.err)}`);
              });
              return;
            }

            // WITHDRAW
            const res = await sendWithdrawRaw({
              programAny,
              provider: authorityProvider,
              authority: protocolAuth,
              amount: step.amount,
              accounts: withdrawAccounts as any,
            });

            if (res.ok) {
              successWithdraws++;
              sumWithdraws += step.amount;
              return;
            }

            const joined = (res.logs ?? []).join("\n");
            if (isPausedLikeText(joined)) {
              rejectedWithdraws++;
              return;
            }

            console.log("withdraw failed sig:", res.sig);
            console.log("logs:\n", (res.logs ?? []).join("\n"));
            throw new Error(`withdraw failed: ${JSON.stringify(res.err)}`);
          },
          `step-${idx}-${step.tag}`,
          10
        );
      });
    } finally {
      // Always unpause
      await withRetry(
        async () => {
          await pauseFn(false)
            .accounts(pauseAccounts as any)
            .signers([protocolAuth])
            .rpc();
        },
        "unpause-end",
        6
      );
    }

    // Snapshot after
    const tAfter = await getAccount(authorityProvider.connection, treasuryAta);
    const rAfter = await getAccount(authorityProvider.connection, recipientAta);
    const uAfter = await getAccount(authorityProvider.connection, authUserAta);

    const treasuryAfter = Number(tAfter.amount);
    const recipientAfter = Number(rAfter.amount);
    const userAfter = Number(uAfter.amount);

    const treasuryDelta = treasuryBefore - treasuryAfter;
    const recipientDelta = recipientAfter - recipientBefore;
    const userDelta = userAfter - userBefore;

    // Sanity (must see both success + rejection)
    expect(pauseSets).to.be.greaterThan(0);

    expect(successPays).to.be.greaterThan(0);
    expect(rejectedPays).to.be.greaterThan(0);

    expect(successWithdraws).to.be.greaterThan(0);
    expect(rejectedWithdraws).to.be.greaterThan(0);

    // Invariants:
    expect(treasuryDelta).to.eq(sumPays + sumWithdraws);
    expect(recipientDelta).to.eq(sumPays);
    expect(userDelta).to.eq(sumWithdraws);

    // eslint-disable-next-line no-console
    console.log("Layer2B results:", {
      CONCURRENCY,
      pauseSets,
      successPays,
      rejectedPays,
      sumPays,
      successWithdraws,
      rejectedWithdraws,
      sumWithdraws,
      treasuryBefore,
      treasuryAfter,
      treasuryDelta,
      recipientBefore,
      recipientAfter,
      recipientDelta,
      userBefore,
      userAfter,
      userDelta,
    });
  });
});
/**
 * Tier1 Stress Suite
 * - Validates pause gating under concurrent load
 * - Validates splPay sequential and bounded concurrency
 * - Ensures treasury delta integrity
 * - Prevents ATA race conditions via precreation
 *
 * Verified stable: v0.29.3
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
  commitment: anchor.web3.Commitment = "confirmed",
  maxMs = 20_000,
  pollMs = 500
) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const tx = await connection.getTransaction(sig, {
      
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
    s.includes("account in use")
  );
}

function isRetryable(err: any) {
  const s = String(err?.message ?? err);
  return (
    isAccountInUseLike(err) ||
    s.includes("Blockhash not found") ||
    s.includes("Transaction was not confirmed") ||
    s.includes("Node is behind") ||
    s.includes("429") ||
    s.toLowerCase().includes("timeout")
  );
}

async function withRetry<T>(fn: () => Promise<T>, tries = 8, delayMs = 150) {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e)) throw e;
      await sleep(delayMs + i * 50);
    }
  }
  throw lastErr;
}

function u64LE(n: anchor.BN): Buffer {
  return n.toArrayLike(Buffer, "le", 8);
}

// Pay receipt PDA for stress: ["receipt", treasuryPda, nonce(u64LE)]
function payReceiptPda(
  programId: PublicKey,
  treasuryPda: PublicKey,
  nonce: anchor.BN
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), treasuryPda.toBuffer(), u64LE(nonce)],
    programId
  );
  return pda;
}

/**
 * Raw tx sender for pause flips.
 * Avoids Anchor error translation + helps prevent "Unknown action 'undefined'" weirdness under load.
 *
 * IDL (confirmed from your grep):
 *   instruction: set_treasury_paused(paused: bool)
 *   accounts: treasury (writable), treasury_authority (signer)
 *
 * In Anchor TS client, accounts are camelCased:
 *   treasuryAuthority  <-- maps to treasury_authority
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

  // forensic check (optional but useful) — RPC can lag under load, so poll briefly
let info = null as any;
const start = Date.now();
const maxMs = 25_000;
const pollMs = 750;

while (!info && Date.now() - start < maxMs) {
  info = await provider.connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!info) {
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

if (!info) {
  const st = await provider.connection.getSignatureStatus(sig, {
    searchTransactionHistory: true,
  });
  throw new Error(
    `getTransaction returned null for pause tx ${sig} after ${maxMs}ms (status=${JSON.stringify(
      st?.value
    )})`
  );
}

if (info.meta?.err) {
  // eslint-disable-next-line no-console
  console.log("PAUSE TX FAILED SIG:", sig);
  // eslint-disable-next-line no-console
  console.log("LOGS:\n", (info.meta.logMessages ?? []).join("\n"));
  throw new Error(`pause tx failed: ${JSON.stringify(info.meta.err)}`);
}


  return sig;
}

/**
 * Raw splPay sender used inside pause flip stress.
 * Returns {ok, logs, err} instead of throwing Anchor-translated errors.
 */
async function sendSplPayRaw(
  programAny: any,
  provider: anchor.AnchorProvider,
  signer: Keypair,
  args: {
    treasuryPda: PublicKey;
    mint: PublicKey;
    treasuryAta: PublicKey;
    recipient: PublicKey;
    recipientAta: PublicKey;
    receipt: PublicKey;
    amount: number;
    nonceBn: anchor.BN;
  }
): Promise<{ sig: string; logs: string[]; ok: boolean; err?: any }> {
  const latest = await provider.connection.getLatestBlockhash("confirmed");

  const tx = await programAny.methods
    .splPay(new BN(args.amount), null, null, args.nonceBn)
    .accounts({
      treasuryAuthority: signer.publicKey,
      recipient: args.recipient,
      treasury: args.treasuryPda,
      mint: args.mint,
      recipientAta: args.recipientAta,
      treasuryAta: args.treasuryAta,
      receipt: args.receipt,
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

  const info = await provider.connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  const logs = info?.meta?.logMessages ?? [];
  const ok = !info?.meta?.err;

  return { sig, logs, ok, err: info?.meta?.err };
}

describe("stress - pause flip under load (Tier1-A)", function () {
  this.timeout(1_000_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = getProgram();
  const programAny = program as any;

  // Always use a real Keypair signer
  const realProtocolAuth = loadProtocolAuthority();

  // Nonce range MUST NOT collide with other tests
  const BASE_NONCE = 5_000_000;

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
        PAY_COUNT + 500
      );
    });

    // recipients (small set reused)
    const recipients: Keypair[] = Array.from({ length: 25 }, () =>
      Keypair.generate()
    );

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
            sendSetPausedRaw(
              programAny,
              provider as any,
              treasuryPda,
              realProtocolAuth,
              true
            )
          );
          await sleep(FLIP_DELAY_MS);

          await withRetry(() =>
            sendSetPausedRaw(
              programAny,
              provider as any,
              treasuryPda,
              realProtocolAuth,
              false
            )
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

          const nonceBn = new BN(BASE_NONCE + i);
          const receipt = payReceiptPda(program.programId, treasuryPda, nonceBn);

          try {
            const result = await withRetry(() =>
              sendSplPayRaw(programAny, provider as any, realProtocolAuth, {
                treasuryPda,
                mint,
                treasuryAta: treasuryAta.address,
                recipient: recipient.publicKey,
                recipientAta,
                receipt,
                amount: PAY_AMOUNT,
                nonceBn,
              })
            );

            if (result.ok) {
              allowedPays++;
              return;
            }

            const joined = (result.logs ?? []).join("\n");
            const looksPaused =
              joined.includes("TreasuryPaused") ||
              joined.includes("ProtocolPaused") ||
              joined.toLowerCase().includes("paused");

            if (looksPaused) {
              rejectedPays++;
              return;
            }

            // Not pause-related => real failure: print forensic payload
            // eslint-disable-next-line no-console
            console.log("SPLPAY FAILED SIG:", result.sig);
            // eslint-disable-next-line no-console
            console.log("LOGS:\n", joined);
            throw new Error(`splPay failed: ${JSON.stringify(result.err)}`);
          } catch (e: any) {
            const msg = String(e?.message ?? e);
            const looksPaused =
              msg.includes("TreasuryPaused") ||
              msg.includes("ProtocolPaused") ||
              msg.toLowerCase().includes("paused");
            if (!looksPaused) throw e;
            rejectedPays++;
          }
        });
      })();

      await Promise.all([flipper, payStorm]);
    } finally {
      // hard guarantee: unpause at the end (prevents poisoning other tests)
      await withRetry(
        () =>
          sendSetPausedRaw(
            programAny,
            provider as any,
            treasuryPda,
            realProtocolAuth,
            false
          ),
        6,
        120
      );
    }

    // snapshot after
    const after = await getAccount(provider.connection, treasuryAta.address);
    const afterAmt = Number(after.amount);

    const delta = beforeAmt - afterAmt;

    // assertions
    expect(rejectedPays).to.be.greaterThan(0);
    expect(allowedPays).to.be.greaterThan(0);
    expect(delta).to.eq(allowedPays * PAY_AMOUNT);

    // eslint-disable-next-line no-console
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








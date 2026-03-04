// tests/stress_tier3b_pause_windows.spec.ts
//
// Tier3B (STRICT): deterministic pause windows under fan-out pay pressure.
// Goal:
// - when unpaused -> pays succeed
// - when paused   -> pays reject
// - invariants hold
//
// STRICT discipline:
// - We bypass Anchor .methods validateAccounts by encoding instructions manually.
// - We also send transactions via raw-send with fresh blockhash + retries.
//
// Receipt mode (canonical, post-v0.31.x):
// - splPay receipts are PAY_COUNT-based:
//   seeds = ["receipt", treasuryPda, pay_count_before(u64LE)]
//
// Why PAY must be serialized (mutex):
// - Two concurrent PAYs can read the same payCountBefore and derive SAME receipt PDA => collision.
// - So: allow concurrency overall, but mutex the PAY critical section.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
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

import { loadProtocolAuthority, airdrop } from "./_helpers";

// ---------- hard-lock classic SPL Tokenkeg + ATA ----------
const TOKEN_PROG = TOKEN_PROGRAM_ID;
const ATA_PROG = ASSOCIATED_TOKEN_PROGRAM_ID;

// ---------- tiny utils ----------
type BN = anchor.BN;
const bn = (x: number | string | bigint) => new anchor.BN(x.toString());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function u64LE(n: anchor.BN) {
  return n.toArrayLike(Buffer, "le", 8);
}

function isPauseError(e: any): boolean {
  const s = String(e?.message ?? e);
  return s.includes("TreasuryPaused") || s.toLowerCase().includes("paused");
}

function isRetryable(e: any): boolean {
  const s = String(e?.message ?? e);
  return (
    s.includes("Blockhash not found") ||
    s.toLowerCase().includes("blockhash not found") ||
    s.includes("Transaction was not confirmed") ||
    s.toLowerCase().includes("timeout") ||
    s.toLowerCase().includes("timed out") ||
    s.includes("Node is behind") ||
    s.includes("429") ||
    s.includes("AccountInUse") ||
    s.toLowerCase().includes("already in use")
  );
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  tries = 10,
  baseDelayMs = 120
): Promise<T> {
  let lastErr: any;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;

      // never retry logical pause gating errors
      if (isPauseError(e)) throw e;
      if (!isRetryable(e)) throw e;

      await sleep(baseDelayMs + i * 80);
    }
  }
  throw new Error(
    `withRetry exhausted (${label}): ${String(lastErr?.message ?? lastErr)}`
  );
}

/**
 * RAW sender that always uses a fresh blockhash.
 * Avoids long-suite flakiness (Blockhash not found).
 */
async function sendRawFresh(
  provider: anchor.AnchorProvider,
  tx: Transaction,
  signers: Keypair[],
  label: string
): Promise<string> {
  return withRetry(
    async () => {
      const feePayer =
        signers[0]?.publicKey ?? (provider.wallet as any).publicKey;
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
    },
    label,
    12,
    140
  );
}

/**
 * Serialize PAY critical section.
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

async function boundedAll<T>(
  items: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await items[i]();
    }
  }

  const workers = Array.from(
    { length: Math.max(1, concurrency) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// ---------- IDL helpers ----------
function getIx(program: Program<any>, name: string): any {
  const ix = (program.idl.instructions as any[]).find((i) => i.name === name);
  if (!ix) throw new Error(`IDL instruction not found: ${name}`);
  return ix;
}

function getIxAccountNames(program: Program<any>, ixName: string): string[] {
  const ix = getIx(program, ixName);
  return (ix.accounts as any[]).map((a) => a.name);
}

// Compat: IDL fields vary across Anchor versions
function accMetaFromIdl(acc: any) {
  const isSigner = !!acc.isSigner;
  const isWritable = !!acc.isMut || !!acc.isWritable || !!acc.writable || false;
  return { isSigner, isWritable };
}

function splPayHasNonceArg(program: Program<any>): boolean {
  const ixDef = getIx(program, "splPay");
  return (ixDef.args as any[]).some((a: any) =>
    String(a.name).toLowerCase().includes("nonce")
  );
}

// receipts (payCount-mode): ["receipt", treasuryPda, payCountBefore(u64LE)]
function receiptPdaPayCount(
  programId: PublicKey,
  treasuryPda: PublicKey,
  payCountBefore: anchor.BN
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), treasuryPda.toBuffer(), u64LE(payCountBefore)],
    programId
  )[0];
}

// ---------- ATA helpers (Tokenkeg locked) ----------
async function ensureAtaExists(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  mint: PublicKey
) {
  const ata = getAssociatedTokenAddressSync(
    mint,
    payer.publicKey,
    false,
    TOKEN_PROG,
    ATA_PROG
  );
  const info = await provider.connection.getAccountInfo(ata);
  if (info) return ata;

  const ix = createAssociatedTokenAccountInstruction(
    payer.publicKey, // payer
    ata,
    payer.publicKey, // owner
    mint,
    TOKEN_PROG,
    ATA_PROG
  );

  const tx = new Transaction().add(ix);
  await sendRawFresh(provider, tx, [payer], "ensureAtaExists");
  return ata;
}

// ---------- RAW instruction builders (STRICT) ----------
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
  const ap = program.provider as anchor.AnchorProvider;
  await sendRawFresh(ap, tx, [authority], paused ? "pause" : "unpause");
}

async function splPayStrictPayCount(
  program: Program<any>,
  authority: Keypair,
  treasuryPda: PublicKey,
  mint: PublicKey,
  recipient: PublicKey,
  amount: number,
  pausedExpected: boolean
): Promise<boolean> {
  const ixDef = getIx(program, "splPay");
  const ap = program.provider as anchor.AnchorProvider;

  const treasuryAta = getAssociatedTokenAddressSync(
    mint,
    treasuryPda,
    true,
    TOKEN_PROG,
    ATA_PROG
  );
  const recipientAta = getAssociatedTokenAddressSync(
    mint,
    recipient,
    false,
    TOKEN_PROG,
    ATA_PROG
  );

  // Fetch payCountBefore (canonical receipt index)
  const treasuryAcc: any = await (program as any).account.treasury.fetch(
    treasuryPda
  );
  const payCountBefore = new anchor.BN(treasuryAcc.payCount);

  const receipt = receiptPdaPayCount(
    program.programId,
    treasuryPda,
    payCountBefore
  );

  // If receipt already exists (rerun), treat as SKIP and do NOT count.
  const receiptInfo = await ap.connection.getAccountInfo(receipt);
  if (receiptInfo) return true;

  const full: Record<string, PublicKey> = {
    treasuryAuthority: authority.publicKey,
    treasury: treasuryPda,
    mint,
    treasuryAta,
    recipient,
    recipientAta,
    receipt,
    tokenProgram: TOKEN_PROG,
    associatedTokenProgram: ATA_PROG,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  };

  // Build args object by IDL arg names.
  // Current Rust: splPay(amount, memo?, reference?) — no nonce.
  const argsObj: any = {};
  for (const a of ixDef.args as any[]) {
    const n = String(a.name).toLowerCase();
    if (n === "amount") argsObj[a.name] = bn(amount);
    else if (n.includes("memo")) argsObj[a.name] = null;
    else if (n.includes("reference")) argsObj[a.name] = null;
    else if (n.includes("nonce")) {
      throw new Error(
        "IDL includes nonce arg but Tier3B is configured for payCount-mode. Fix IDL/Rust alignment."
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

  const tx = new Transaction().add(ix);

  try {
    await sendRawFresh(ap, tx, [authority], "splPayStrictPayCount");
    if (pausedExpected) {
      throw new Error("Tier3B breach: splPay succeeded while treasury paused.");
    }
    return true;
  } catch (e: any) {
    if (pausedExpected && isPauseError(e)) return false;
    throw e;
  }
}

// ---------- SPEC ----------
describe("stress - Tier3B deterministic pause windows (STRICT)", () => {
  let program: Program<any>;
  let provider: anchor.AnchorProvider;

  let treasuryPda: PublicKey;
  let mint: PublicKey;
  let treasuryAtaPk: PublicKey;

  let protocolAuth: Keypair;

  const RECIPIENTS = 8;
  const recipients: Keypair[] = [];

  const TOTAL_ATTEMPTS = 120;
  const CONCURRENCY = 10;
  const PAY_AMOUNT = 111;

  const UNPAUSED_BLOCK = 15;
  const PAUSED_BLOCK = 5;

  before(async () => {
    const envProvider = anchor.AnchorProvider.env();

    protocolAuth = loadProtocolAuthority();
    await airdrop(envProvider, protocolAuth.publicKey, 2);
    await sleep(120);

    provider = new anchor.AnchorProvider(
      envProvider.connection,
      new anchor.Wallet(protocolAuth),
      {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
        skipPreflight: false,
      }
    );
    anchor.setProvider(provider);

    // Fresh Program bound to our provider
    // @ts-ignore
    const wsProgram = anchor.workspace.Protocol as Program<any>;
    const ctorArity = (Program as any).length;
    console.log("DEBUG Program ctor arity:", ctorArity);

    if (ctorArity >= 3) {
      program = new (Program as any)(wsProgram.idl, wsProgram.programId, provider);
    } else {
      const idl = wsProgram.idl as any;
      idl.metadata = { ...(idl.metadata ?? {}), address: wsProgram.programId.toBase58() };
      program = new (Program as any)(idl, provider);
    }

    const ap = program.provider as anchor.AnchorProvider;
    console.log("Tier3B programId:", program.programId.toBase58());
    console.log("Tier3B provider wallet:", ap.wallet.publicKey.toBase58());
    console.log("Tier3B protocolAuth:", protocolAuth.publicKey.toBase58());

    [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );

    const usesNonce = splPayHasNonceArg(program);
    console.log("Tier3B receipt mode:", usesNonce ? "nonce-mode" : "payCount-mode");
    if (usesNonce) {
      throw new Error(
        "Tier3B expects payCount-mode splPay receipts, but IDL shows nonce arg. Fix program/IDL alignment."
      );
    }

    // Create fresh mint (FORCED classic Tokenkeg)
    mint = await createMint(
      provider.connection,
      protocolAuth,
      protocolAuth.publicKey,
      null,
      6,
      undefined,     // keypair
      undefined,     // confirmOptions
      TOKEN_PROG     // <-- FORCE Tokenkeg
    );

    // Sanity: ensure mint is actually owned by Tokenkeg (catches suite drift)
    const mintInfo = await provider.connection.getAccountInfo(mint);
    if (!mintInfo) throw new Error("Mint account missing right after createMint()");
    if (!mintInfo.owner.equals(TOKEN_PROG)) {
      throw new Error(
        `Tier3B mint owner mismatch. mint=${mint.toBase58()} owner=${mintInfo.owner.toBase58()} expected Tokenkeg=${TOKEN_PROG.toBase58()}`
      );
    }

    // Create treasury ATA (Tokenkeg locked)
    treasuryAtaPk = getAssociatedTokenAddressSync(
      mint,
      treasuryPda,
      true,
      TOKEN_PROG,
      ATA_PROG
    );

    const treasuryAtaInfo = await provider.connection.getAccountInfo(treasuryAtaPk);
    if (!treasuryAtaInfo) {
      const ix = createAssociatedTokenAccountInstruction(
        protocolAuth.publicKey,
        treasuryAtaPk,
        treasuryPda,
        mint,
        TOKEN_PROG,
        ATA_PROG
      );
      await sendRawFresh(
        provider,
        new Transaction().add(ix),
        [protocolAuth],
        "tier3b-create-treasury-ata"
      );
    }

    // Fund treasury ATA (FORCED Tokenkeg)
    await withRetry(
      () =>
        mintTo(
          provider.connection,
          protocolAuth,
          mint,
          treasuryAtaPk,
          protocolAuth.publicKey,
          5_000_000,
          [],          // multiSigners
          undefined,   // confirmOptions
          TOKEN_PROG   // <-- FORCE Tokenkeg
        ),
      "tier3b-mintTo",
      12,
      160
    );

    console.log("Tier3B resolved mint:", mint.toBase58());
    console.log("Tier3B resolved treasuryAta:", treasuryAtaPk.toBase58());

    // Recipients + airdrop + ATAs
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

    await Promise.all(recipients.map((r) => ensureAtaExists(provider, r, mint)));

    // Ensure unpaused
    await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);

    console.log("Tier3B IDL splPay accounts:", getIxAccountNames(program, "splPay"));
    console.log(
      "Tier3B IDL setTreasuryPaused accounts:",
      getIxAccountNames(program, "setTreasuryPaused")
    );
  });

  it("Tier3B-mini: single splPay call sanity", async () => {
    await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);
    const recipient = recipients[0].publicKey;

    const ok = await splPayStrictPayCount(
      program,
      protocolAuth,
      treasuryPda,
      mint,
      recipient,
      PAY_AMOUNT,
      false
    );
    expect(ok).to.eq(true);
  });

  it("Tier3B: deterministic pause windows preserve invariants under fan-out pressure", async () => {
    const treasuryBefore = await getAccount(provider.connection, treasuryAtaPk);

    const recipientAtas = recipients.map((r) =>
      getAssociatedTokenAddressSync(mint, r.publicKey, false, TOKEN_PROG, ATA_PROG)
    );
    const recipientsBefore = await Promise.all(
      recipientAtas.map((ata) => getAccount(provider.connection, ata))
    );

    let attemptsDone = 0;
    let successCount = 0;
    let rejectCount = 0;

    let sumSuccessfulPays = bn(0);

    const payLock = createMutex();

    while (attemptsDone < TOTAL_ATTEMPTS) {
      const unpausedN = Math.min(UNPAUSED_BLOCK, TOTAL_ATTEMPTS - attemptsDone);
      await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);

      const unpausedTasks = Array.from({ length: unpausedN }, (_, k) => async () => {
        const r = recipients[(attemptsDone + k) % recipients.length].publicKey;
        return payLock(async () => {
          return splPayStrictPayCount(
            program,
            protocolAuth,
            treasuryPda,
            mint,
            r,
            PAY_AMOUNT,
            false
          );
        });
      });

      const unpausedResults = await boundedAll(unpausedTasks, CONCURRENCY);
      for (const ok of unpausedResults) {
        if (!ok) throw new Error("Unexpected rejection during UNPAUSED window.");
        successCount++;
        sumSuccessfulPays = sumSuccessfulPays.add(bn(PAY_AMOUNT));
      }

      attemptsDone += unpausedN;
      if (attemptsDone >= TOTAL_ATTEMPTS) break;

      const pausedN = Math.min(PAUSED_BLOCK, TOTAL_ATTEMPTS - attemptsDone);
      await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, true);

      const pausedTasks = Array.from({ length: pausedN }, (_, k) => async () => {
        const r = recipients[(attemptsDone + k) % recipients.length].publicKey;
        return payLock(async () => {
          return splPayStrictPayCount(
            program,
            protocolAuth,
            treasuryPda,
            mint,
            r,
            PAY_AMOUNT,
            true
          );
        });
      });

      const pausedResults = await boundedAll(pausedTasks, CONCURRENCY);
      for (const ok of pausedResults) {
        if (ok) throw new Error("Unexpected SUCCESS during PAUSED window (governance breach).");
        rejectCount++;
      }

      attemptsDone += pausedN;

      await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);
    }

    expect(successCount).to.be.greaterThan(0);
    expect(rejectCount).to.be.greaterThan(0);

    const treasuryAfter = await getAccount(provider.connection, treasuryAtaPk);
    const recipientsAfter = await Promise.all(
      recipientAtas.map((ata) => getAccount(provider.connection, ata))
    );

    const treasuryDelta = bn(treasuryBefore.amount.toString()).sub(
      bn(treasuryAfter.amount.toString())
    );

    let recipientAggregateDelta = bn(0);
    for (let i = 0; i < recipients.length; i++) {
      const d = bn(recipientsAfter[i].amount.toString()).sub(
        bn(recipientsBefore[i].amount.toString())
      );
      recipientAggregateDelta = recipientAggregateDelta.add(d);
    }

    expect(
      treasuryDelta.eq(sumSuccessfulPays),
      "treasuryDelta != sumSuccessfulPays"
    ).to.eq(true);
    expect(
      recipientAggregateDelta.eq(sumSuccessfulPays),
      "recipientAggregateDelta != sumSuccessfulPays"
    ).to.eq(true);

    console.log({
      attemptsDone,
      successCount,
      rejectCount,
      sumSuccessfulPays: sumSuccessfulPays.toString(),
      treasuryDelta: treasuryDelta.toString(),
      recipientAggregateDelta: recipientAggregateDelta.toString(),
    });
  });
});










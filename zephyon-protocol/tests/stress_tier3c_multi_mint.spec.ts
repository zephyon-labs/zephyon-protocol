// tests/stress_tier3c_multi_mint.spec.ts
//
// Tier3C: Multi-mint isolation (STRICT)
// - Same treasury PDA
// - Two SPL mints (A + B)
// - Treasury holds two ATAs (one per mint)
// - Recipients hold ATAs for both mints
// - Deterministic alternating pay stream: A, B, A, B...
// - Deterministic pause windows:
//    unpaused block => pays must succeed
//    paused block   => pays must reject
// - Invariants per mint:
//    treasuryDelta_X == sumPays_X == recipientAggregateDelta_X
//
// IMPORTANT:
// Receipt PDA seeds are ["receipt", treasuryPda, nonce(u64LE)] (NO mint seed).
// So we MUST partition nonce ranges per mint to avoid collisions.

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

// receipts: ["receipt", treasuryPda, nonce(u64LE)]
function payReceiptPda(programId: PublicKey, treasuryPda: PublicKey, nonce: anchor.BN) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), treasuryPda.toBuffer(), u64LE(nonce)],
    programId
  )[0];
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

async function boundedAll<T>(items: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await items[i]();
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return results;
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

// ---------- STRICT raw builders ----------

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

type PayOutcome =
  | { kind: "SUCCESS"; amount: number }
  | { kind: "REJECT_PAUSED"; amount: number }
  | { kind: "SKIPPED_RECEIPT_EXISTS"; amount: number };

async function splPayStrictExplicit(
  program: Program<any>,
  authority: Keypair,
  treasuryPda: PublicKey,
  mint: PublicKey,
  treasuryAta: PublicKey,
  recipient: PublicKey,
  recipientAta: PublicKey,
  amount: number,
  nonce: anchor.BN,
  pausedExpected: boolean
): Promise<PayOutcome> {
  const ixDef = getIx(program, "splPay");

  const receipt = payReceiptPda(program.programId, treasuryPda, nonce);

  // If receipt already exists (rerun), treat as SKIPPED (do not count it).
  const ap = program.provider as anchor.AnchorProvider;
  const receiptInfo = await ap.connection.getAccountInfo(receipt);
  if (receiptInfo) return { kind: "SKIPPED_RECEIPT_EXISTS", amount };

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

  // Build args object based on IDL arg names
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
      throw new Error("Tier3C breach: splPay succeeded while treasury paused.");
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

describe("stress - Tier3C multi-mint isolation (STRICT)", () => {
  let program: Program<any>;
  let provider: anchor.AnchorProvider;

  let protocolAuth: Keypair;
  let treasuryPda: PublicKey;

  // mints + treasury ATAs
  let mintA: PublicKey;
  let mintB: PublicKey;
  let treasuryAtaA: PublicKey;
  let treasuryAtaB: PublicKey;

  const SEED = Number(process.env.TIER3C_SEED ?? "1337");

  const RECIPIENTS = Number(process.env.TIER3C_RECIPIENTS ?? "10");
  const TOTAL_ATTEMPTS = Number(process.env.TIER3C_ATTEMPTS ?? "200");
  const CONCURRENCY = Number(process.env.TIER3C_CONCURRENCY ?? "10");

  const UNPAUSED_BLOCK = Number(process.env.TIER3C_UNPAUSED_BLOCK ?? "16");
  const PAUSED_BLOCK = Number(process.env.TIER3C_PAUSED_BLOCK ?? "6");

  // Deterministic amounts per mint (keeps sums easy + audit-readable)
  const PAY_A = Number(process.env.TIER3C_PAY_A ?? "111");
  const PAY_B = Number(process.env.TIER3C_PAY_B ?? "222");

  // Nonce partitioning: huge separation to avoid collisions across mints
  const NONCE_STRIDE = new anchor.BN("5000000000"); // 5b gap
  const BASE = new anchor.BN(NONCE_PAY_BASE).add(new anchor.BN(SEED).mul(new anchor.BN(1_000_000)));

  const NONCE_BASE_A = BASE;
  const NONCE_BASE_B = BASE.add(NONCE_STRIDE);

  const recipients: Keypair[] = [];
  let recipientAtasA: PublicKey[] = [];
  let recipientAtasB: PublicKey[] = [];

  before(async () => {
    const envProvider = anchor.AnchorProvider.env();
    anchor.setProvider(envProvider);

    protocolAuth = loadProtocolAuthority();
    await airdrop(envProvider, protocolAuth.publicKey, 2);
    await sleep(120);

    provider = new anchor.AnchorProvider(envProvider.connection, new anchor.Wallet(protocolAuth), {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
      skipPreflight: false,
    });
    anchor.setProvider(provider);

    // Workspace program is cached; build fresh Program bound to our provider (Tier3B discipline)
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

    // treasury PDA
    [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], program.programId);

    // Create two new mints, mint authority = protocolAuth
    // (We mint directly to treasury ATAs to fund them for pay streams.)
    mintA = await createMint(provider.connection, protocolAuth, protocolAuth.publicKey, null, 6);
    mintB = await createMint(provider.connection, protocolAuth, protocolAuth.publicKey, null, 6);

    // Treasury ATAs for both mints (owner is off-curve PDA => allowOwnerOffCurve = true)
    treasuryAtaA = getAssociatedTokenAddressSync(mintA, treasuryPda, true);
    treasuryAtaB = getAssociatedTokenAddressSync(mintB, treasuryPda, true);

    // Create treasury ATAs if missing (payer = protocolAuth)
    for (const [mint, ata] of [
      [mintA, treasuryAtaA] as const,
      [mintB, treasuryAtaB] as const,
    ]) {
      const info = await provider.connection.getAccountInfo(ata);
      if (!info) {
        const ix = createAssociatedTokenAccountInstruction(
          protocolAuth.publicKey,
          ata,
          treasuryPda,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );
        await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix), [protocolAuth]);
      }
    }

    // Fund treasury for both mints
    await mintTo(provider.connection, protocolAuth, mintA, treasuryAtaA, protocolAuth.publicKey, 2_000_000);
    await mintTo(provider.connection, protocolAuth, mintB, treasuryAtaB, protocolAuth.publicKey, 2_000_000);

    // Recipients
    recipients.length = 0;
    for (let i = 0; i < RECIPIENTS; i++) recipients.push(Keypair.generate());

    // Airdrop recipients (for ATA rent)
    await Promise.all(
      recipients.map(async (r) => {
        const sig = await provider.connection.requestAirdrop(
          r.publicKey,
          0.25 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(sig, "confirmed");
      })
    );

    // Ensure recipient ATAs for both mints
    await Promise.all(recipients.map((r) => ensureAtaExists(provider, r, mintA)));
    await Promise.all(recipients.map((r) => ensureAtaExists(provider, r, mintB)));

    recipientAtasA = recipients.map((r) => getAssociatedTokenAddressSync(mintA, r.publicKey, false));
    recipientAtasB = recipients.map((r) => getAssociatedTokenAddressSync(mintB, r.publicKey, false));

    // Normalize: start unpaused
    await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);
  });

  after(async () => {
    // Keep suite clean
    await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);
  });

  it("Tier3C: two-mint alternating pay stream preserves invariants per mint under pause windows", async () => {
    const treasuryBeforeA = await getAccount(provider.connection, treasuryAtaA);
    const treasuryBeforeB = await getAccount(provider.connection, treasuryAtaB);

    const recipientsBeforeA = await Promise.all(recipientAtasA.map((ata) => getAccount(provider.connection, ata)));
    const recipientsBeforeB = await Promise.all(recipientAtasB.map((ata) => getAccount(provider.connection, ata)));

    let attemptsDone = 0;
    let successA = 0;
    let successB = 0;
    let rejectCount = 0;
    let skippedCount = 0;

    let sumPaysA = bn(0);
    let sumPaysB = bn(0);

    // Deterministic alternating selection:
    // attempt i uses mint A if i even, mint B if i odd.
    const pickMint = (attemptIndex: number) => (attemptIndex % 2 === 0 ? "A" : "B");

    while (attemptsDone < TOTAL_ATTEMPTS) {
      // UNPAUSED WINDOW
      const unpausedN = Math.min(UNPAUSED_BLOCK, TOTAL_ATTEMPTS - attemptsDone);
      await withRetry(() => setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false), { label: "unpause" });

      const unpausedTasks = Array.from({ length: unpausedN }, (_, k) => async () => {
        const idx = attemptsDone + k;
        const r = recipients[idx % recipients.length].publicKey;

        const which = pickMint(idx);
        const nonce = (which === "A" ? NONCE_BASE_A : NONCE_BASE_B).add(new anchor.BN(idx + 1));

        if (which === "A") {
          const recipientAta = recipientAtasA[idx % recipients.length];
          return splPayStrictExplicit(
            program,
            protocolAuth,
            treasuryPda,
            mintA,
            treasuryAtaA,
            r,
            recipientAta,
            PAY_A,
            nonce,
            false
          );
        } else {
          const recipientAta = recipientAtasB[idx % recipients.length];
          return splPayStrictExplicit(
            program,
            protocolAuth,
            treasuryPda,
            mintB,
            treasuryAtaB,
            r,
            recipientAta,
            PAY_B,
            nonce,
            false
          );
        }
      });

      const unpausedResults = await boundedAll(unpausedTasks, CONCURRENCY);
      for (const out of unpausedResults) {
        if (out.kind === "SUCCESS") {
          // classify by amount (deterministic)
          if (out.amount === PAY_A) {
            successA++;
            sumPaysA = sumPaysA.add(bn(out.amount));
          } else {
            successB++;
            sumPaysB = sumPaysB.add(bn(out.amount));
          }
        } else if (out.kind === "SKIPPED_RECEIPT_EXISTS") {
          skippedCount++;
        } else {
          throw new Error("Unexpected reject during UNPAUSED window.");
        }
      }

      attemptsDone += unpausedN;
      if (attemptsDone >= TOTAL_ATTEMPTS) break;

      // PAUSED WINDOW
      const pausedN = Math.min(PAUSED_BLOCK, TOTAL_ATTEMPTS - attemptsDone);
      await withRetry(() => setTreasuryPausedStrict(program, protocolAuth, treasuryPda, true), { label: "pause" });

      const pausedTasks = Array.from({ length: pausedN }, (_, k) => async () => {
        const idx = attemptsDone + k;
        const r = recipients[idx % recipients.length].publicKey;

        const which = pickMint(idx);
        const nonce = (which === "A" ? NONCE_BASE_A : NONCE_BASE_B).add(new anchor.BN(idx + 1));

        if (which === "A") {
          const recipientAta = recipientAtasA[idx % recipients.length];
          return splPayStrictExplicit(
            program,
            protocolAuth,
            treasuryPda,
            mintA,
            treasuryAtaA,
            r,
            recipientAta,
            PAY_A,
            nonce,
            true
          );
        } else {
          const recipientAta = recipientAtasB[idx % recipients.length];
          return splPayStrictExplicit(
            program,
            protocolAuth,
            treasuryPda,
            mintB,
            treasuryAtaB,
            r,
            recipientAta,
            PAY_B,
            nonce,
            true
          );
        }
      });

      const pausedResults = await boundedAll(pausedTasks, CONCURRENCY);
      for (const out of pausedResults) {
        if (out.kind === "REJECT_PAUSED") rejectCount++;
        else if (out.kind === "SKIPPED_RECEIPT_EXISTS") skippedCount++;
        else throw new Error("Unexpected SUCCESS during PAUSED window.");
      }

      attemptsDone += pausedN;

      // Unpause before next loop
      await withRetry(() => setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false), { label: "unpause-post" });
    }

    // Require signal
    expect(successA + successB).to.be.greaterThan(0);
    expect(rejectCount).to.be.greaterThan(0);

    // After balances
    const treasuryAfterA = await getAccount(provider.connection, treasuryAtaA);
    const treasuryAfterB = await getAccount(provider.connection, treasuryAtaB);

    const recipientsAfterA = await Promise.all(recipientAtasA.map((ata) => getAccount(provider.connection, ata)));
    const recipientsAfterB = await Promise.all(recipientAtasB.map((ata) => getAccount(provider.connection, ata)));

    // Deltas per mint
    const treasuryDeltaA = bn(treasuryBeforeA.amount.toString()).sub(bn(treasuryAfterA.amount.toString()));
    const treasuryDeltaB = bn(treasuryBeforeB.amount.toString()).sub(bn(treasuryAfterB.amount.toString()));

    let recipientDeltaA = bn(0);
    for (let i = 0; i < recipients.length; i++) {
      const d = bn(recipientsAfterA[i].amount.toString()).sub(bn(recipientsBeforeA[i].amount.toString()));
      recipientDeltaA = recipientDeltaA.add(d);
    }

    let recipientDeltaB = bn(0);
    for (let i = 0; i < recipients.length; i++) {
      const d = bn(recipientsAfterB[i].amount.toString()).sub(bn(recipientsBeforeB[i].amount.toString()));
      recipientDeltaB = recipientDeltaB.add(d);
    }

    // Invariants per mint
    expect(treasuryDeltaA.eq(sumPaysA), "MintA treasuryDelta != sumPaysA").to.eq(true);
    expect(recipientDeltaA.eq(sumPaysA), "MintA recipientDelta != sumPaysA").to.eq(true);

    expect(treasuryDeltaB.eq(sumPaysB), "MintB treasuryDelta != sumPaysB").to.eq(true);
    expect(recipientDeltaB.eq(sumPaysB), "MintB recipientDelta != sumPaysB").to.eq(true);

    console.log("Tier3C Evidence:", {
      seed: SEED,
      attemptsDone,
      successA,
      successB,
      rejectCount,
      skippedCount,
      sumPaysA: sumPaysA.toString(),
      treasuryDeltaA: treasuryDeltaA.toString(),
      recipientDeltaA: recipientDeltaA.toString(),
      sumPaysB: sumPaysB.toString(),
      treasuryDeltaB: treasuryDeltaB.toString(),
      recipientDeltaB: recipientDeltaB.toString(),
    });
  });
});
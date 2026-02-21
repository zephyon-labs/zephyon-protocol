// tests/stress_tier3b_pause_windows.spec.ts
//
// Tier3B (STRICT): deterministic pause windows under fan-out pay pressure.
// Goal: when unpaused -> pays succeed; when paused -> pays reject; invariants hold.
//
// This file intentionally BYPASSES Anchor's `.methods.*` validateAccounts layer for splPay,
// because validateAccounts() was falsely claiming `treasuryAuthority` is missing even when present.
// We encode instructions via `program.coder.instruction.encode()` and build TransactionInstruction manually.

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

import { loadProtocolAuthority, airdrop } from "./_helpers";

// ---------- tiny utils ----------
type BN = anchor.BN;
const bn = (x: number | string | bigint) => new anchor.BN(x.toString());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function u64LE(n: anchor.BN) {
  return n.toArrayLike(Buffer, "le", 8);
}

// Pay receipts: ["receipt", treasuryPda, nonce(u64LE)]
function payReceiptPda(programId: PublicKey, treasuryPda: PublicKey, nonce: anchor.BN) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), treasuryPda.toBuffer(), u64LE(nonce)],
    programId
  )[0];
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

// ---------- RAW instruction builders (bypass validateAccounts) ----------

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

  // 🔎 Debug: show which fields exist in IDL for mutability/signing
  console.log(
    "DEBUG setTreasuryPaused accounts flags:",
    (ixDef.accounts as any[]).map((a: any) => ({
      name: a.name,
      isMut: a.isMut,
      isWritable: a.isWritable,
      writable: a.writable,
      isSigner: a.isSigner,
    }))
  );

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

async function splPayStrict(
  program: Program<any>,
  authority: Keypair,
  treasuryPda: PublicKey,
  mint: PublicKey,
  recipient: PublicKey,
  amount: number,
  nonce: anchor.BN,
  expectPausedReject?: boolean
): Promise<boolean> {
  const ixDef = getIx(program, "splPay");

  const treasuryAta = getAssociatedTokenAddressSync(mint, treasuryPda, true);
  const recipientAta = getAssociatedTokenAddressSync(mint, recipient, false);
  const receipt = payReceiptPda(program.programId, treasuryPda, nonce);
    // If receipt PDA already exists, treat as success for stress runs (idempotent)
  const receiptInfo = await (program.provider as anchor.AnchorProvider).connection.getAccountInfo(receipt);
  if (receiptInfo) {
    return true;
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

  // Build args object based on IDL arg names (handles amount + any nonce-like arg + memo-ish args)
  const argsObj: any = {};
  for (const a of ixDef.args as any[]) {
    const n = String(a.name);
    if (n === "amount") argsObj[n] = bn(amount);
    else if (n.toLowerCase().includes("memo")) argsObj[n] = null;
    else if (n.toLowerCase().includes("nonce")) argsObj[n] = nonce; // receiptNonce/payNonce/nonce
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

  // Minimal proof logs
  const ap = program.provider as anchor.AnchorProvider;
  console.log("DEBUG programId:", program.programId.toBase58());
  console.log("DEBUG provider wallet:", ap.wallet.publicKey.toBase58());
  console.log("DEBUG IDL splPay accounts:", getIxAccountNames(program, "splPay"));

  const ix = new anchor.web3.TransactionInstruction({
    programId: program.programId,
    keys,
    data,
  });

  const tx = new anchor.web3.Transaction().add(ix);

  try {
    await ap.sendAndConfirm(tx, [authority]);

    return true;
  } catch (e: any) {
    if (expectPausedReject) {
      if (!isPauseError(e)) {
        throw new Error(`Expected pause rejection, got: ${String(e?.message ?? e)}`);
      }
      return false;
    }
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
  const RUN_NONCE_BASE = new anchor.BN(Date.now()).mul(new anchor.BN(1_000_000));


  before(async () => {
    // Start with env provider (connection + opts)
    const envProvider = anchor.AnchorProvider.env();
    anchor.setProvider(envProvider);

    protocolAuth = loadProtocolAuthority();
    await airdrop(envProvider, protocolAuth.publicKey, 2);
    await sleep(150);

    // Create provider bound to protocolAuth wallet
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

    // Workspace program is cached; build a fresh Program bound to our provider
    // @ts-ignore
    const wsProgram = anchor.workspace.Protocol as Program<any>;

    // Detect Program constructor signature at runtime (anchor versions differ)
    const ctorArity = (Program as any).length;
    console.log("DEBUG Program ctor arity:", ctorArity);

    if (ctorArity >= 3) {
      // (idl, programId, provider)
      program = new (Program as any)(wsProgram.idl, wsProgram.programId, provider);
    } else {
      // (idl, provider) — ensure IDL contains address so programId is known
      const idl = wsProgram.idl as any;
      idl.metadata = { ...(idl.metadata ?? {}), address: wsProgram.programId.toBase58() };
      program = new (Program as any)(idl, provider);
    }

    const ap = program.provider as anchor.AnchorProvider;
    console.log("Tier3B programId:", program.programId.toBase58());
    console.log("Tier3B provider wallet:", ap.wallet.publicKey.toBase58());
    console.log("Tier3B protocolAuth:", protocolAuth.publicKey.toBase58());

    if (ap.wallet.publicKey.toBase58() !== protocolAuth.publicKey.toBase58()) {
      throw new Error("Provider wallet mismatch: Program not bound correctly.");
    }

    // Derive treasury PDA
    [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], program.programId);

    // Discover treasury token account + mint
    const tokenAccounts = await provider.connection.getTokenAccountsByOwner(treasuryPda, {
      programId: TOKEN_PROGRAM_ID,
    });
    if (!tokenAccounts.value.length) {
      throw new Error("Treasury PDA has no SPL token accounts (expected funded treasury).");
    }

    treasuryAtaPk = tokenAccounts.value[0].pubkey;
    const treasuryTokenAcc = await getAccount(provider.connection, treasuryAtaPk);
    mint = treasuryTokenAcc.mint;

    console.log("Tier3B resolved mint:", mint.toBase58());
    console.log("Tier3B resolved treasuryAta:", treasuryAtaPk.toBase58());

    // Build recipients + fund them for ATA rent
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

    // Ensure starting unpaused
    await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);

    // IDL proof
    console.log("Tier3B IDL splPay accounts:", getIxAccountNames(program, "splPay"));
    console.log("Tier3B IDL setTreasuryPaused accounts:", getIxAccountNames(program, "setTreasuryPaused"));
  });

  it("Tier3B-mini: single splPay call sanity", async () => {
    await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);
    const recipient = recipients[0].publicKey;

    const ok = await splPayStrict(
      program,
      protocolAuth,
      treasuryPda,
      mint,
      recipient,
      PAY_AMOUNT,
      new anchor.BN(999_001)
    );
    expect(ok).to.eq(true);
  });

  it("Tier3B: deterministic pause windows preserve invariants under fan-out pressure", async () => {
    const treasuryBefore = await getAccount(provider.connection, treasuryAtaPk);

    const recipientAtas = recipients.map((r) => getAssociatedTokenAddressSync(mint, r.publicKey, false));
    const recipientsBefore = await Promise.all(recipientAtas.map((ata) => getAccount(provider.connection, ata)));

    let attemptsDone = 0;
    let successCount = 0;
    let rejectCount = 0;

    let sumSuccessfulPays = bn(0);

    while (attemptsDone < TOTAL_ATTEMPTS) {
      // UNPAUSED WINDOW
      const unpausedN = Math.min(UNPAUSED_BLOCK, TOTAL_ATTEMPTS - attemptsDone);
      await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);

      const unpausedTasks = Array.from({ length: unpausedN }, (_, k) => async () => {
        const recipient = recipients[(attemptsDone + k) % recipients.length].publicKey;
        const nonce = RUN_NONCE_BASE.add(new anchor.BN(attemptsDone + k + 1));

        return splPayStrict(program, protocolAuth, treasuryPda, mint, recipient, PAY_AMOUNT, nonce);
      });

      const unpausedResults = await boundedAll(unpausedTasks, CONCURRENCY);
      for (const ok of unpausedResults) {
        if (!ok) throw new Error("Unexpected rejection during UNPAUSED window.");
        successCount++;
        sumSuccessfulPays = sumSuccessfulPays.add(bn(PAY_AMOUNT));
      }

      attemptsDone += unpausedN;
      if (attemptsDone >= TOTAL_ATTEMPTS) break;

      // PAUSED WINDOW
      const pausedN = Math.min(PAUSED_BLOCK, TOTAL_ATTEMPTS - attemptsDone);
      await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, true);

      const pausedTasks = Array.from({ length: pausedN }, (_, k) => async () => {
        const recipient = recipients[(attemptsDone + k) % recipients.length].publicKey;
        const nonce = RUN_NONCE_BASE.add(new anchor.BN(attemptsDone + k + 1));

        return splPayStrict(program, protocolAuth, treasuryPda, mint, recipient, PAY_AMOUNT, nonce, true);
      });

      const pausedResults = await boundedAll(pausedTasks, CONCURRENCY);
      for (const ok of pausedResults) {
        if (ok) throw new Error("Unexpected SUCCESS during PAUSED window (governance breach).");
        rejectCount++;
      }

      attemptsDone += pausedN;

      // unpause for next loop
      await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);
    }

    expect(successCount).to.be.greaterThan(0);
    expect(rejectCount).to.be.greaterThan(0);

    const treasuryAfter = await getAccount(provider.connection, treasuryAtaPk);
    const recipientsAfter = await Promise.all(recipientAtas.map((ata) => getAccount(provider.connection, ata)));

    const treasuryDelta = bn(treasuryBefore.amount.toString()).sub(bn(treasuryAfter.amount.toString()));

    let recipientAggregateDelta = bn(0);
    for (let i = 0; i < recipients.length; i++) {
      const d = bn(recipientsAfter[i].amount.toString()).sub(bn(recipientsBefore[i].amount.toString()));
      recipientAggregateDelta = recipientAggregateDelta.add(d);
    }

    // Invariants
    expect(treasuryDelta.eq(sumSuccessfulPays), "treasuryDelta != sumSuccessfulPays").to.eq(true);
    expect(recipientAggregateDelta.eq(sumSuccessfulPays), "recipientAggregateDelta != sumSuccessfulPays").to.eq(true);

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











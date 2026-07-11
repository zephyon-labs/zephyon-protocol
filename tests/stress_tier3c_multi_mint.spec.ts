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
// Canonical rewrite:
// - preserve adaptive receipt logic
// - preserve per-mint invariant checks
// - preserve pay serialization in payCount mode
// - replace manual mint/ATA bootstrap with canonical setup + explicit deposit
// - use finalized transport

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
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
} from "@solana/spl-token";
import { expect } from "chai";

import {
  loadProtocolAuthority,
  airdrop,
  initFoundationOnce,
  derivePayReceiptPda,
  getTreasuryPayCount,
  setupMintAndAtas,
} from "./_helpers";

/* -----------------------------
 * tiny utils
 * ----------------------------- */

const bn = (x: number | string | bigint) => new anchor.BN(x.toString());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function u64LE(n: anchor.BN) {
  return n.toArrayLike(Buffer, "le", 8);
}

function isPauseError(e: any): boolean {
  const s = String(e?.message ?? e).toLowerCase();
  return (
    s.includes("treasurypaused") ||
    s.includes("protocolpaused") ||
    s.includes("paused") ||
    s.includes("custom program error: 0x1770")
  );
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

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  tries = 8,
  baseDelayMs = 100
): Promise<T> {
  let lastErr: any;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (!isRetryable(e)) throw e;
      await sleep(baseDelayMs + i * 40);
    }
  }
  throw new Error(
    `withRetry exhausted (${label}): ${String(lastErr?.message ?? lastErr)}`
  );
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

function splPayHasNonceArg(program: Program<any>): boolean {
  const ixDef = getIx(program, "splPay");
  return (ixDef.args as any[]).some((a: any) =>
    String(a.name).toLowerCase().includes("nonce")
  );
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
 * transport
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
    commitment = "finalized",
  } = args;

  const feePayer = signers[0]?.publicKey ?? (provider.wallet as any).publicKey;
  tx.feePayer = feePayer;

  const latest = await provider.connection.getLatestBlockhash("finalized");
  tx.recentBlockhash = latest.blockhash;
  tx.sign(...signers);

  const sig = await provider.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "finalized",
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

  return sig;
}

/* -----------------------------
 * adaptive receipt derivation
 * ----------------------------- */

async function deriveReceiptPdaAdaptive(args: {
  program: Program<any>;
  treasuryPda: PublicKey;
  nonceIfUsed: anchor.BN;
}): Promise<{ receipt: PublicKey; seedValue: anchor.BN; usesNonce: boolean }> {
  const { program, treasuryPda, nonceIfUsed } = args;

  const usesNonce = splPayHasNonceArg(program);

  if (usesNonce) {
    const seedValue = nonceIfUsed;
    const [receipt] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), treasuryPda.toBuffer(), u64LE(seedValue)],
      program.programId
    );
    return { receipt, seedValue, usesNonce };
  }

  const seedValue = new anchor.BN(
    (await getTreasuryPayCount(program, treasuryPda)).toString()
  );
  const [receipt] = derivePayReceiptPda(program.programId, treasuryPda, seedValue);
  return { receipt, seedValue, usesNonce };
}

/* -----------------------------
 * ATA helper
 * ----------------------------- */

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

  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    allowOwnerOffCurve,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const info = await provider.connection.getAccountInfo(ata, "finalized");
  if (info) return ata;

  const ix = createAssociatedTokenAccountInstruction(
    payer.publicKey,
    ata,
    owner,
    mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  await withRetry(
    async () => {
      try {
        await sendRawTxFresh({
          provider,
          tx: new Transaction().add(ix),
          signers: [payer],
          commitment: "finalized",
        });
      } catch (e: any) {
        const msg = String(e?.message ?? e).toLowerCase();
        if (
          msg.includes("already in use") ||
          msg.includes("custom program error: 0x0")
        ) {
          const now = await provider.connection.getAccountInfo(ata, "finalized");
          if (now) return;
        }
        throw e;
      }
    },
    `ensure-ata-${ata.toBase58().slice(0, 8)}`,
    8,
    120
  );

  return ata;
}

/* -----------------------------
 * strict builders
 * ----------------------------- */

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

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys,
    data,
  });

  await sendRawTxFresh({
    provider: program.provider as AnchorProvider,
    tx: new Transaction().add(ix),
    signers: [authority],
    commitment: "finalized",
  });
}

async function buildSplDepositTx(args: {
  program: Program<any>;
  user: Keypair;
  treasuryPda: PublicKey;
  mint: PublicKey;
  userAta: PublicKey;
  treasuryAta: PublicKey;
  amount: bigint;
}): Promise<Transaction> {
  const { program, user, treasuryPda, mint, userAta, treasuryAta, amount } = args;

  const ixDef = getIx(program, "splDeposit");

  const full: Record<string, PublicKey> = {
    user: user.publicKey,
    treasury: treasuryPda,
    mint,
    userAta,
    treasuryAta,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  };

  const argsObj: any = {};
  for (const a of ixDef.args as any[]) {
    const lower = String(a.name).toLowerCase();
    if (lower === "amount") argsObj[a.name] = bn(amount);
    else argsObj[a.name] = null;
  }

  const data = program.coder.instruction.encode("splDeposit", argsObj);

  const keys = (ixDef.accounts as any[]).map((acc: any) => {
    const pubkey = full[acc.name];
    if (!pubkey) {
      throw new Error(
        `Missing account '${acc.name}' for splDeposit. Provided: ${Object.keys(full).join(", ")}`
      );
    }
    const { isSigner, isWritable } = accMetaFromIdl(acc);
    return { pubkey, isSigner, isWritable };
  });

  return new Transaction().add(
    new TransactionInstruction({
      programId: program.programId,
      keys,
      data,
    })
  );
}

type PayOutcome =
  | { kind: "SUCCESS"; amount: number; mintTag: "A" | "B" }
  | { kind: "REJECT_PAUSED"; amount: number; mintTag: "A" | "B" }
  | { kind: "SKIPPED_RECEIPT_EXISTS"; amount: number; mintTag: "A" | "B" };

async function splPayStrictExplicit(args: {
  program: Program<any>;
  authority: Keypair;
  treasuryPda: PublicKey;
  mint: PublicKey;
  treasuryAta: PublicKey;
  recipient: PublicKey;
  recipientAta: PublicKey;
  amount: number;
  nonce: anchor.BN;
  pausedExpected: boolean;
  mintTag: "A" | "B";
}): Promise<PayOutcome> {
  const {
    program,
    authority,
    treasuryPda,
    mint,
    treasuryAta,
    recipient,
    recipientAta,
    amount,
    nonce,
    pausedExpected,
    mintTag,
  } = args;

  const ixDef = getIx(program, "splPay");
  const { receipt, seedValue, usesNonce } = await deriveReceiptPdaAdaptive({
    program,
    treasuryPda,
    nonceIfUsed: nonce,
  });

  const ap = program.provider as AnchorProvider;

  const receiptInfo = await ap.connection.getAccountInfo(receipt, "finalized");
  if (receiptInfo) {
    return { kind: "SKIPPED_RECEIPT_EXISTS", amount, mintTag };
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

  const argsObj: any = {};
  for (const a of ixDef.args as any[]) {
    const n = String(a.name).toLowerCase();

    if (n === "amount") argsObj[a.name] = bn(amount);
    else if (n.includes("memo")) argsObj[a.name] = null;
    else if (n.includes("reference")) argsObj[a.name] = null;
    else if (n.includes("nonce")) argsObj[a.name] = usesNonce ? seedValue : null;
    else argsObj[a.name] = null;
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

  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: program.programId,
      keys,
      data,
    })
  );

  try {
    await sendRawTxFresh({
      provider: ap,
      tx,
      signers: [authority],
      commitment: "finalized",
    });

    if (pausedExpected) {
      throw new Error("Tier3C breach: splPay succeeded while treasury paused.");
    }

    return { kind: "SUCCESS", amount, mintTag };
  } catch (e: any) {
    if (pausedExpected && isPauseError(e)) {
      return { kind: "REJECT_PAUSED", amount, mintTag };
    }
    throw e;
  }
}

/* -----------------------------
 * spec
 * ----------------------------- */

describe("stress - Tier3C multi-mint isolation (STRICT)", function () {
  this.timeout(3_600_000);

  let program: Program<any>;
  let provider: AnchorProvider;

  let protocolAuth: Keypair;
  let treasuryPda: PublicKey;

  let mintA: PublicKey;
  let mintB: PublicKey;
  let treasuryAtaA: PublicKey;
  let treasuryAtaB: PublicKey;
  let userAtaA: PublicKey;
  let userAtaB: PublicKey;

  const SEED = Number(process.env.TIER3C_SEED ?? "1337");

  const RECIPIENTS = Number(process.env.TIER3C_RECIPIENTS ?? "10");
  const TOTAL_ATTEMPTS = Number(process.env.TIER3C_ATTEMPTS ?? "200");
  const CONCURRENCY = Number(process.env.TIER3C_CONCURRENCY ?? "10");

  const UNPAUSED_BLOCK = Number(process.env.TIER3C_UNPAUSED_BLOCK ?? "16");
  const PAUSED_BLOCK = Number(process.env.TIER3C_PAUSED_BLOCK ?? "6");

  const PAY_A = Number(process.env.TIER3C_PAY_A ?? "111");
  const PAY_B = Number(process.env.TIER3C_PAY_B ?? "222");

  const BASE = new anchor.BN(SEED).mul(new anchor.BN(1_000_000));
  const NONCE_STRIDE = new anchor.BN("5000000000");
  const NONCE_BASE_A = BASE;
  const NONCE_BASE_B = BASE.add(NONCE_STRIDE);

  const recipients: Keypair[] = [];
  let recipientAtasA: PublicKey[] = [];
  let recipientAtasB: PublicKey[] = [];

  let usesNonceMode = false;
  const payLock = createMutex();

  before(async () => {
    const envProvider = anchor.AnchorProvider.env();
    protocolAuth = loadProtocolAuthority();

    await airdrop(envProvider, protocolAuth.publicKey, 2, "finalized");
    await sleep(120);

    provider = new anchor.AnchorProvider(
      envProvider.connection,
      new anchor.Wallet(protocolAuth),
      {
        commitment: "finalized",
        preflightCommitment: "finalized",
        skipPreflight: false,
      }
    );
    anchor.setProvider(provider);

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

    await initFoundationOnce(provider, program);

    usesNonceMode = splPayHasNonceArg(program);
    console.log("Tier3C receipt mode:", usesNonceMode ? "nonce-mode" : "payCount-mode");

    [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );

    // Canonical setup for mint A
    {
      const setupA = await setupMintAndAtas(provider, protocolAuth, treasuryPda, 2_000_000n);
      mintA = setupA.mint;
      userAtaA = setupA.userAta;
      treasuryAtaA = setupA.treasuryAta;

      const depositA = await buildSplDepositTx({
        program,
        user: protocolAuth,
        treasuryPda,
        mint: mintA,
        userAta: userAtaA,
        treasuryAta: treasuryAtaA,
        amount: 2_000_000n,
      });

      await sendRawTxFresh({
        provider,
        tx: depositA,
        signers: [protocolAuth],
        commitment: "finalized",
      });
    }

    // Canonical setup for mint B
    {
      const setupB = await setupMintAndAtas(provider, protocolAuth, treasuryPda, 2_000_000n);
      mintB = setupB.mint;
      userAtaB = setupB.userAta;
      treasuryAtaB = setupB.treasuryAta;

      const depositB = await buildSplDepositTx({
        program,
        user: protocolAuth,
        treasuryPda,
        mint: mintB,
        userAta: userAtaB,
        treasuryAta: treasuryAtaB,
        amount: 2_000_000n,
      });

      await sendRawTxFresh({
        provider,
        tx: depositB,
        signers: [protocolAuth],
        commitment: "finalized",
      });
    }

    recipients.length = 0;
    for (let i = 0; i < RECIPIENTS; i++) recipients.push(Keypair.generate());

    await Promise.all(recipients.map((r) => airdrop(provider, r.publicKey, 0.25, "finalized")));

    await Promise.all(
      recipients.map((r) =>
        ensureAtaExists({
          provider,
          payer: protocolAuth,
          owner: r.publicKey,
          mint: mintA,
        })
      )
    );

    await Promise.all(
      recipients.map((r) =>
        ensureAtaExists({
          provider,
          payer: protocolAuth,
          owner: r.publicKey,
          mint: mintB,
        })
      )
    );

    recipientAtasA = recipients.map((r) =>
      getAssociatedTokenAddressSync(
        mintA,
        r.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    recipientAtasB = recipients.map((r) =>
      getAssociatedTokenAddressSync(
        mintB,
        r.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);
  });

  after(async () => {
    await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);
  });

  it("Tier3C: two-mint alternating pay stream preserves invariants per mint under pause windows", async () => {
    const treasuryBeforeA = await getAccount(provider.connection, treasuryAtaA);
    const treasuryBeforeB = await getAccount(provider.connection, treasuryAtaB);

    const recipientsBeforeA = await Promise.all(
      recipientAtasA.map((ata) => getAccount(provider.connection, ata))
    );
    const recipientsBeforeB = await Promise.all(
      recipientAtasB.map((ata) => getAccount(provider.connection, ata))
    );

    let attemptsDone = 0;
    let successA = 0;
    let successB = 0;
    let rejectCount = 0;
    let skippedCount = 0;

    let sumPaysA = bn(0);
    let sumPaysB = bn(0);

    const pickMint = (attemptIndex: number) => (attemptIndex % 2 === 0 ? "A" : "B");

    while (attemptsDone < TOTAL_ATTEMPTS) {
      const unpausedN = Math.min(UNPAUSED_BLOCK, TOTAL_ATTEMPTS - attemptsDone);
      await withRetry(
        () => setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false),
        "tier3c-unpause"
      );

      const unpausedTasks = Array.from({ length: unpausedN }, (_, k) => async () => {
        const idx = attemptsDone + k;
        const rIndex = idx % recipients.length;
        const r = recipients[rIndex].publicKey;

        const which = pickMint(idx);
        const nonce = (which === "A" ? NONCE_BASE_A : NONCE_BASE_B).add(
          new anchor.BN(idx + 1)
        );

        const doPay = async () => {
          if (which === "A") {
            return splPayStrictExplicit({
              program,
              authority: protocolAuth,
              treasuryPda,
              mint: mintA,
              treasuryAta: treasuryAtaA,
              recipient: r,
              recipientAta: recipientAtasA[rIndex],
              amount: PAY_A,
              nonce,
              pausedExpected: false,
              mintTag: "A",
            });
          } else {
            return splPayStrictExplicit({
              program,
              authority: protocolAuth,
              treasuryPda,
              mint: mintB,
              treasuryAta: treasuryAtaB,
              recipient: r,
              recipientAta: recipientAtasB[rIndex],
              amount: PAY_B,
              nonce,
              pausedExpected: false,
              mintTag: "B",
            });
          }
        };

        return usesNonceMode ? doPay() : payLock(doPay);
      });

      const unpausedResults = await boundedAll(unpausedTasks, CONCURRENCY);
      for (const out of unpausedResults) {
        if (out.kind === "SUCCESS") {
          if (out.mintTag === "A") {
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

      const pausedN = Math.min(PAUSED_BLOCK, TOTAL_ATTEMPTS - attemptsDone);
      await withRetry(
        () => setTreasuryPausedStrict(program, protocolAuth, treasuryPda, true),
        "tier3c-pause"
      );

      const pausedTasks = Array.from({ length: pausedN }, (_, k) => async () => {
        const idx = attemptsDone + k;
        const rIndex = idx % recipients.length;
        const r = recipients[rIndex].publicKey;

        const which = pickMint(idx);
        const nonce = (which === "A" ? NONCE_BASE_A : NONCE_BASE_B).add(
          new anchor.BN(idx + 1)
        );

        const doPay = async () => {
          if (which === "A") {
            return splPayStrictExplicit({
              program,
              authority: protocolAuth,
              treasuryPda,
              mint: mintA,
              treasuryAta: treasuryAtaA,
              recipient: r,
              recipientAta: recipientAtasA[rIndex],
              amount: PAY_A,
              nonce,
              pausedExpected: true,
              mintTag: "A",
            });
          } else {
            return splPayStrictExplicit({
              program,
              authority: protocolAuth,
              treasuryPda,
              mint: mintB,
              treasuryAta: treasuryAtaB,
              recipient: r,
              recipientAta: recipientAtasB[rIndex],
              amount: PAY_B,
              nonce,
              pausedExpected: true,
              mintTag: "B",
            });
          }
        };

        return usesNonceMode ? doPay() : payLock(doPay);
      });

      const pausedResults = await boundedAll(pausedTasks, CONCURRENCY);
      for (const out of pausedResults) {
        if (out.kind === "REJECT_PAUSED") rejectCount++;
        else if (out.kind === "SKIPPED_RECEIPT_EXISTS") skippedCount++;
        else throw new Error("Unexpected SUCCESS during PAUSED window.");
      }

      attemptsDone += pausedN;

      await withRetry(
        () => setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false),
        "tier3c-unpause-post"
      );
    }

    expect(successA + successB).to.be.greaterThan(0);
    expect(rejectCount).to.be.greaterThan(0);

    const treasuryAfterA = await getAccount(provider.connection, treasuryAtaA);
    const treasuryAfterB = await getAccount(provider.connection, treasuryAtaB);

    const recipientsAfterA = await Promise.all(
      recipientAtasA.map((ata) => getAccount(provider.connection, ata))
    );
    const recipientsAfterB = await Promise.all(
      recipientAtasB.map((ata) => getAccount(provider.connection, ata))
    );

    const treasuryDeltaA = bn(treasuryBeforeA.amount.toString()).sub(
      bn(treasuryAfterA.amount.toString())
    );
    const treasuryDeltaB = bn(treasuryBeforeB.amount.toString()).sub(
      bn(treasuryAfterB.amount.toString())
    );

    let recipientDeltaA = bn(0);
    for (let i = 0; i < recipients.length; i++) {
      recipientDeltaA = recipientDeltaA.add(
        bn(recipientsAfterA[i].amount.toString()).sub(
          bn(recipientsBeforeA[i].amount.toString())
        )
      );
    }

    let recipientDeltaB = bn(0);
    for (let i = 0; i < recipients.length; i++) {
      recipientDeltaB = recipientDeltaB.add(
        bn(recipientsAfterB[i].amount.toString()).sub(
          bn(recipientsBeforeB[i].amount.toString())
        )
      );
    }

    expect(treasuryDeltaA.eq(sumPaysA), "MintA treasuryDelta != sumPaysA").to.eq(true);
    expect(recipientDeltaA.eq(sumPaysA), "MintA recipientDelta != sumPaysA").to.eq(true);

    expect(treasuryDeltaB.eq(sumPaysB), "MintB treasuryDelta != sumPaysB").to.eq(true);
    expect(recipientDeltaB.eq(sumPaysB), "MintB recipientDelta != sumPaysB").to.eq(true);

    console.log("Tier3C Evidence:", {
      seed: SEED,
      receiptMode: usesNonceMode ? "nonce-mode" : "payCount-mode",
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
// tests/stress_tier3b_pause_windows.spec.ts
//
// Tier3B (STRICT): deterministic pause windows under fan-out pay pressure.
//
// Goal:
// - when unpaused -> pays succeed
// - when paused   -> pays reject
// - invariants hold
//
// STRICT discipline:
// - manually encoded instructions
// - hardened raw-send path with fresh blockhash
// - canonical funding through setupMintAndAtas + splDeposit
// - payCount-based receipts
// - PAY serialized with mutex in payCount-mode

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
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
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
 * IDL helpers
 * ----------------------------- */

function toSnakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function toCamelCase(name: string): string {
  return name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function getIx(program: Program<any>, name: string): any {
  const candidates = new Set([name, toSnakeCase(name), toCamelCase(name)]);
  const ix = (program.idl.instructions as any[]).find((i) =>
    candidates.has(String(i.name))
  );
  if (!ix) {
    throw new Error(
      `IDL instruction not found: ${name}. Available: ${(program.idl.instructions as any[])
        .map((i) => i.name)
        .join(", ")}`
    );
  }
  return ix;
}

function getIxAccountNames(program: Program<any>, ixName: string): string[] {
  const ix = getIx(program, ixName);
  return (ix.accounts as any[]).map((a) => a.name);
}

function accMetaFromIdl(acc: any) {
  const isSigner = !!acc.isSigner || !!acc.signer;
  const isWritable =
    !!acc.isMut || !!acc.isWritable || !!acc.writable || false;
  return { isSigner, isWritable };
}

function splPayHasNonceArg(program: Program<any>): boolean {
  const ixDef = getIx(program, "spl_pay");
  return (ixDef.args as any[]).some((a: any) =>
    String(a.name).toLowerCase().includes("nonce")
  );
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
  label?: string;
}): Promise<PublicKey> {
  const {
    provider,
    payer,
    owner,
    mint,
    allowOwnerOffCurve = false,
    label = "tier3b-ata",
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
    `${label}-create`,
    10,
    150
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
  const ixDef = getIx(program, "set_treasury_paused");

  const full: Record<string, PublicKey> = {
    treasury_authority: authority.publicKey,
    treasury: treasuryPda,
    system_program: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,

    // compat aliases
    treasuryAuthority: authority.publicKey,
    systemProgram: anchor.web3.SystemProgram.programId,
  };

  const data = program.coder.instruction.encode("setTreasuryPaused", { paused });

  const keys = (ixDef.accounts as any[]).map((acc: any) => {
    const pubkey = full[String(acc.name)];
    if (!pubkey) {
      throw new Error(
        `Missing account '${acc.name}' for set_treasury_paused. Provided: ${Object.keys(
          full
        ).join(", ")}`
      );
    }
    const { isSigner, isWritable } = accMetaFromIdl(acc);
    return { pubkey, isSigner, isWritable };
  });

  await sendRawTxFresh({
    provider: program.provider as AnchorProvider,
    tx: new Transaction().add(
      new TransactionInstruction({
        programId: program.programId,
        keys,
        data,
      })
    ),
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

  const ixDef = getIx(program, "spl_deposit");

  const full: Record<string, PublicKey> = {
    user: user.publicKey,
    treasury: treasuryPda,
    mint,
    user_ata: userAta,
    treasury_ata: treasuryAta,
    token_program: TOKEN_PROGRAM_ID,
    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
    system_program: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,

    // compat aliases
    userAta,
    treasuryAta,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
  };

  const argsObj: any = {};
  for (const a of ixDef.args as any[]) {
    const lower = String(a.name).toLowerCase();
    if (lower === "amount") argsObj[a.name] = bn(amount);
    else argsObj[a.name] = null;
  }

  const data = program.coder.instruction.encode("splDeposit", argsObj);

  const keys = (ixDef.accounts as any[]).map((acc: any) => {
    const pubkey = full[String(acc.name)];
    if (!pubkey) {
      throw new Error(
        `Missing account '${acc.name}' for spl_deposit. Provided: ${Object.keys(full).join(
          ", "
        )}`
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

type AttemptResult = "success" | "rejected" | "skipped";

async function splPayStrictPayCount(
  program: Program<any>,
  authority: Keypair,
  treasuryPda: PublicKey,
  mint: PublicKey,
  recipient: PublicKey,
  amount: number,
  pausedExpected: boolean
): Promise<AttemptResult> {
  const ixDef = getIx(program, "spl_pay");
  const ap = program.provider as AnchorProvider;

  const treasuryAta = getAssociatedTokenAddressSync(
    mint,
    treasuryPda,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const recipientAta = getAssociatedTokenAddressSync(
    mint,
    recipient,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const payCountBefore = new anchor.BN(
    (await getTreasuryPayCount(program, treasuryPda)).toString()
  );

  const [receipt] = derivePayReceiptPda(
    program.programId,
    treasuryPda,
    payCountBefore
  );

  const receiptInfo = await ap.connection.getAccountInfo(receipt, "finalized");
  if (receiptInfo) return "skipped";

  const full: Record<string, PublicKey> = {
    treasury_authority: authority.publicKey,
    recipient,
    treasury: treasuryPda,
    mint,
    recipient_ata: recipientAta,
    treasury_ata: treasuryAta,
    receipt,
    token_program: TOKEN_PROGRAM_ID,
    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
    system_program: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,

    // compat aliases
    treasuryAuthority: authority.publicKey,
    recipientAta,
    treasuryAta,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
  };

  const argsObj: any = {};
  for (const a of ixDef.args as any[]) {
    const rawName = String(a.name);
    const n = rawName.toLowerCase();
    if (n === "amount") argsObj[rawName] = bn(amount);
    else if (n.includes("memo")) argsObj[rawName] = null;
    else if (n.includes("reference")) argsObj[rawName] = null;
    else if (n.includes("nonce")) {
      throw new Error(
        "IDL includes nonce arg but Tier3B is configured for payCount-mode. Fix IDL/Rust alignment."
      );
    } else {
      argsObj[rawName] = null;
    }
  }

  const data = program.coder.instruction.encode("splPay", argsObj);

  const keys = (ixDef.accounts as any[]).map((acc: any) => {
    const pubkey = full[String(acc.name)];
    if (!pubkey) {
      throw new Error(
        `Missing account '${acc.name}' for spl_pay. Provided: ${Object.keys(full).join(
          ", "
        )}`
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
      throw new Error("Tier3B breach: splPay succeeded while treasury paused.");
    }

    return "success";
  } catch (e: any) {
    if (pausedExpected && isPauseError(e)) return "rejected";
    throw e;
  }
}

/* -----------------------------
 * spec
 * ----------------------------- */

describe("stress - Tier3B deterministic pause windows (STRICT)", function () {
  this.timeout(5_400_000);

  let program: Program<any>;
  let provider: AnchorProvider;

  let treasuryPda: PublicKey;
  let mint: PublicKey;
  let treasuryAtaPk: PublicKey;
  let userAtaPk: PublicKey;

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
    console.log("DEBUG Program ctor arity:", ctorArity);

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

    const ap = program.provider as AnchorProvider;
    console.log("Tier3B programId:", program.programId.toBase58());
    console.log("Tier3B provider wallet:", ap.wallet.publicKey.toBase58());
    console.log("Tier3B protocolAuth:", protocolAuth.publicKey.toBase58());

    await initFoundationOnce(provider, program);

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

    const setup = await setupMintAndAtas(
      provider,
      protocolAuth,
      treasuryPda,
      5_000_000n
    );

    mint = setup.mint;
    userAtaPk = setup.userAta;
    treasuryAtaPk = setup.treasuryAta;

    const depositTx = await buildSplDepositTx({
      program,
      user: protocolAuth,
      treasuryPda,
      mint,
      userAta: userAtaPk,
      treasuryAta: treasuryAtaPk,
      amount: 5_000_000n,
    });

    await sendRawTxFresh({
      provider,
      tx: depositTx,
      signers: [protocolAuth],
      commitment: "finalized",
    });

    console.log("Tier3B resolved mint:", mint.toBase58());
    console.log("Tier3B resolved treasuryAta:", treasuryAtaPk.toBase58());

    recipients.length = 0;
    for (let i = 0; i < RECIPIENTS; i++) recipients.push(Keypair.generate());

    await Promise.all(recipients.map((r) => airdrop(provider, r.publicKey, 0.25, "finalized")));

    for (let i = 0; i < recipients.length; i++) {
      await ensureAtaExists({
        provider,
        payer: protocolAuth,
        owner: recipients[i].publicKey,
        mint,
        allowOwnerOffCurve: false,
        label: `tier3b-recipient-${i + 1}-ata`,
      });
    }

    await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);

    console.log("Tier3B IDL splPay accounts:", getIxAccountNames(program, "spl_pay"));
    console.log(
      "Tier3B IDL setTreasuryPaused accounts:",
      getIxAccountNames(program, "set_treasury_paused")
    );
  });

  it("Tier3B-mini: single splPay call sanity", async () => {
    await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);
    const recipient = recipients[0].publicKey;

    const result = await splPayStrictPayCount(
      program,
      protocolAuth,
      treasuryPda,
      mint,
      recipient,
      PAY_AMOUNT,
      false
    );

    expect(result).to.eq("success");
  });

  it("Tier3B: deterministic pause windows preserve invariants under fan-out pressure", async () => {
    const treasuryBefore = await getAccount(provider.connection, treasuryAtaPk);

    const recipientAtas = recipients.map((r) =>
      getAssociatedTokenAddressSync(
        mint,
        r.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    const recipientsBefore = await Promise.all(
      recipientAtas.map((ata) => getAccount(provider.connection, ata))
    );

    let attemptsDone = 0;
    let successCount = 0;
    let rejectCount = 0;
    let skipCount = 0;

    let sumSuccessfulPays = bn(0);

    const payLock = createMutex();

    while (attemptsDone < TOTAL_ATTEMPTS) {
      const unpausedN = Math.min(UNPAUSED_BLOCK, TOTAL_ATTEMPTS - attemptsDone);
      await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);

      const unpausedTasks = Array.from({ length: unpausedN }, (_, k) => async () => {
        const r = recipients[(attemptsDone + k) % recipients.length].publicKey;
        return payLock(async () =>
          splPayStrictPayCount(
            program,
            protocolAuth,
            treasuryPda,
            mint,
            r,
            PAY_AMOUNT,
            false
          )
        );
      });

      const unpausedResults = await boundedAll(unpausedTasks, CONCURRENCY);
      for (const result of unpausedResults) {
        if (result === "rejected") {
          throw new Error("Unexpected rejection during UNPAUSED window.");
        }
        if (result === "success") {
          successCount++;
          sumSuccessfulPays = sumSuccessfulPays.add(bn(PAY_AMOUNT));
        }
        if (result === "skipped") {
          skipCount++;
        }
      }

      attemptsDone += unpausedN;
      if (attemptsDone >= TOTAL_ATTEMPTS) break;

      const pausedN = Math.min(PAUSED_BLOCK, TOTAL_ATTEMPTS - attemptsDone);
      await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, true);

      const pausedTasks = Array.from({ length: pausedN }, (_, k) => async () => {
        const r = recipients[(attemptsDone + k) % recipients.length].publicKey;
        return payLock(async () =>
          splPayStrictPayCount(
            program,
            protocolAuth,
            treasuryPda,
            mint,
            r,
            PAY_AMOUNT,
            true
          )
        );
      });

      const pausedResults = await boundedAll(pausedTasks, CONCURRENCY);
      for (const result of pausedResults) {
        if (result === "success") {
          throw new Error(
            "Unexpected SUCCESS during PAUSED window (governance breach)."
          );
        }
        if (result === "rejected") {
          rejectCount++;
        }
        if (result === "skipped") {
          skipCount++;
        }
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

    console.log("Tier3B Evidence:", {
      attemptsDone,
      successCount,
      rejectCount,
      skipCount,
      expectedMoved: sumSuccessfulPays.toString(),
      treasuryDelta: treasuryDelta.toString(),
      recipientAggregateDelta: recipientAggregateDelta.toString(),
    });
  });
});










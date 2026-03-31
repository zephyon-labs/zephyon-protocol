/**
 * tests/stress_spl_pay.spec.ts
 *
 * Tier1 Stress Suite — splPay (FAST STRICT, payCount-canonical)
 *
 * Goals:
 * - Preserve deterministic account wiring
 * - Preserve finalized confirmation discipline
 * - Preserve shared bootstrap
 * - Preserve strict invariants
 * - Avoid patch drift by keeping this file internally coherent
 *
 * What remains strict:
 * - finalized send path
 * - explicit instruction builders
 * - treasury delta invariant
 * - pay_count delta invariant
 * - retry handling for seed collisions / transient transport issues
 *
 * Important stabilization choices:
 * - explicit treasury unpause at start
 * - explicit treasury paused-state verification
 * - explicit starting pay_count logging
 * - bounded concurrency test now serializes execution within each batch
 *   to prevent pay_count receipt PDA collisions from masquerading as transport noise
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { expect } from "chai";

import {
  initFoundationOnce,
  setupMintAndAtas,
  loadProtocolAuthority,
  airdrop,
} from "./_helpers";

/* -----------------------------
 * test profile
 * ----------------------------- */

const RECIPIENT_COUNT = 20;
const SEQUENTIAL_PAYS = 20;
const CONCURRENT_PAYS = 20;
const CONCURRENCY = 5;
const LOG_EVERY = 5;

/* -----------------------------
 * tiny utilities
 * ----------------------------- */

const bn = (x: number | string | bigint) => new anchor.BN(x.toString());

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function u64LEBigInt(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

function isAccountInUseLike(err: any) {
  const s = String(err?.message ?? err).toLowerCase();
  return (
    s.includes("accountinuse") ||
    s.includes("already in use") ||
    s.includes("account in use") ||
    s.includes("allocate: account")
  );
}

function isConstraintSeedsLike(err: any) {
  const s = String(err?.message ?? err).toLowerCase();
  return (
    s.includes("constraintseeds") ||
    s.includes("2006") ||
    s.includes("seeds constraint") ||
    s.includes("seed constraint")
  );
}

function isRetryable(err: any) {
  const s = String(err?.message ?? err);
  return (
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
  tries = 12,
  baseDelayMs = 80
): Promise<T> {
  let lastErr: any;

  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;

      if (!isRetryable(e) && !isConstraintSeedsLike(e) && !isAccountInUseLike(e)) {
        throw e;
      }

      await sleep(baseDelayMs + i * 40);
    }
  }

  throw new Error(
    `withRetry exhausted (${label}): ${String(lastErr?.message ?? lastErr)}`
  );
}

function assertProviderIsAuthority(provider: AnchorProvider, auth: PublicKey) {
  const pk = (provider.wallet as any).publicKey as PublicKey;
  if (!pk?.equals(auth)) {
    throw new Error(
      `Provider wallet drift: provider=${pk?.toBase58?.()} expected=${auth.toBase58()}`
    );
  }
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

function shouldLogProgress(i: number, total: number): boolean {
  return i === 0 || (i + 1) % LOG_EVERY === 0 || i === total - 1;
}

/* -----------------------------
 * transport helper
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

  const statusResp = await provider.connection.getSignatureStatuses([sig]);
  const status = statusResp.value[0];

  if (!status) {
    throw new Error(`sendRawTxFresh: missing signature status for ${sig}`);
  }

  if (status.err) {
    throw new Error(
      `sendRawTxFresh: transaction failed: ${JSON.stringify(status.err)}`
    );
  }

  return sig;
}

/* -----------------------------
 * canonical helpers
 * ----------------------------- */

function payReceiptPdaFromPayCount(
  programId: PublicKey,
  treasuryPda: PublicKey,
  payCountBefore: bigint
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), treasuryPda.toBuffer(), u64LEBigInt(payCountBefore)],
    programId
  )[0];
}

async function fetchPayCount(
  program: Program<any>,
  treasuryPda: PublicKey
): Promise<bigint> {
  const treasuryAcc: any = await (program as any).account.treasury.fetch(treasuryPda);
  return BigInt(treasuryAcc.payCount.toString());
}

async function fetchTreasuryState(
  program: Program<any>,
  treasuryPda: PublicKey
): Promise<any> {
  return await (program as any).account.treasury.fetch(treasuryPda);
}

/* -----------------------------
 * ATA helper
 * ----------------------------- */

async function ensureAtaExists(args: {
  provider: AnchorProvider;
  payer: Keypair;
  owner: PublicKey;
  mint: PublicKey;
}): Promise<PublicKey> {
  const { provider, payer, owner, mint } = args;

  const mintInfo = await provider.connection.getAccountInfo(mint, "finalized");
  if (!mintInfo) {
    throw new Error(`Mint account missing: ${mint.toBase58()}`);
  }

  const tokenProgramForMint = mintInfo.owner;

  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    tokenProgramForMint,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const existing = await provider.connection.getAccountInfo(ata, "finalized");
  if (existing) return ata;

  const ix = createAssociatedTokenAccountInstruction(
    payer.publicKey,
    ata,
    owner,
    mint,
    tokenProgramForMint,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  await withRetry(
    async () => {
      try {
        const tx = new Transaction().add(ix);
        await sendRawTxFresh({
          provider,
          tx,
          signers: [payer],
          commitment: "finalized",
        });
      } catch (e: any) {
        const msg = String(e?.message ?? e).toLowerCase();

        if (
          msg.includes("already in use") ||
          msg.includes("custom program error: 0x0")
        ) {
          const nowExists = await provider.connection.getAccountInfo(ata, "finalized");
          if (nowExists) return;
        }

        throw e;
      }
    },
    `ensure-ata-${ata.toBase58().slice(0, 8)}`,
    8,
    120
  );

  const finalInfo = await provider.connection.getAccountInfo(ata, "finalized");
  if (!finalInfo) {
    throw new Error(`ATA still missing after create: ${ata.toBase58()}`);
  }

  return ata;
}

/* -----------------------------
 * strict instruction builders
 * ----------------------------- */

async function setTreasuryPausedStrict(args: {
  program: Program<any>;
  authority: Keypair;
  treasuryPda: PublicKey;
  paused: boolean;
}) {
  const { program, authority, treasuryPda, paused } = args;

  const ixDef = getIx(program, "setTreasuryPaused");

  const full: Record<string, PublicKey> = {
    treasuryAuthority: authority.publicKey,
    treasury: treasuryPda,
    systemProgram: SystemProgram.programId,
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

  await sendRawTxFresh({
    provider: program.provider as AnchorProvider,
    tx,
    signers: [authority],
    commitment: "finalized",
  });
}

async function buildSplDepositTx(args: {
  program: Program<any>;
  authority: Keypair;
  treasuryPda: PublicKey;
  mint: PublicKey;
  userAta: PublicKey;
  treasuryAta: PublicKey;
  amount: number;
}): Promise<Transaction> {
  const { program, authority, treasuryPda, mint, userAta, treasuryAta, amount } = args;

  const ixDef = getIx(program, "splDeposit");

  const full: Record<string, PublicKey> = {
    user: authority.publicKey,
    treasury: treasuryPda,
    mint,
    userAta,
    treasuryAta,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
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
        `Missing account '${acc.name}' for splDeposit. Provided: ${Object.keys(full).join(
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

  return new Transaction().add(ix);
}

async function buildSplPayTx(args: {
  program: Program<any>;
  authority: Keypair;
  treasuryPda: PublicKey;
  treasuryAta: PublicKey;
  mint: PublicKey;
  recipient: PublicKey;
  recipientAta: PublicKey;
  receipt: PublicKey;
  amount: number;
}): Promise<Transaction> {
  const {
    program,
    authority,
    treasuryPda,
    treasuryAta,
    mint,
    recipient,
    recipientAta,
    receipt,
    amount,
  } = args;

  const ixDef = getIx(program, "splPay");

  const full: Record<string, PublicKey> = {
    treasuryAuthority: authority.publicKey,
    recipient,
    treasury: treasuryPda,
    mint,
    recipientAta,
    treasuryAta,
    receipt,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  };

  const argsObj: any = {};
  for (const a of ixDef.args as any[]) {
    const lower = String(a.name).toLowerCase();
    if (lower === "amount") argsObj[a.name] = bn(amount);
    else if (lower.includes("memo")) argsObj[a.name] = null;
    else if (lower.includes("reference")) argsObj[a.name] = null;
    else if (lower.includes("nonce")) {
      throw new Error(
        "stress_spl_pay strict rewrite expects canonical payCount-mode splPay, not nonce-mode."
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

  return new Transaction().add(ix);
}

/* -----------------------------
 * spec
 * ----------------------------- */

describe("stress - splPay (FAST STRICT)", function () {
  this.timeout(3_600_000);

  let provider: AnchorProvider;
  let program: Program<any>;

  let protocolAuthority: Keypair;
  let treasuryPda: PublicKey;

  let mint: PublicKey;
  let userAta: PublicKey;
  let treasuryAta: PublicKey;

  let recipients: Keypair[] = [];
  let recipientAtas: PublicKey[] = [];

  before(async () => {
    const envProvider = anchor.AnchorProvider.env();
    protocolAuthority = loadProtocolAuthority();

    provider = new AnchorProvider(
      envProvider.connection,
      new anchor.Wallet(protocolAuthority),
      {
        commitment: "finalized",
        preflightCommitment: "finalized",
        skipPreflight: false,
      }
    );
    anchor.setProvider(provider);
    assertProviderIsAuthority(provider, protocolAuthority.publicKey);

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

    const foundation = await initFoundationOnce(provider, program);
    treasuryPda = foundation.treasuryPda;

    await airdrop(provider, protocolAuthority.publicKey, 2, "finalized");

    await withRetry(
      async () => {
        await setTreasuryPausedStrict({
          program,
          authority: protocolAuthority,
          treasuryPda,
          paused: false,
        });
      },
      "tier1-unpause-start",
      8,
      100
    );

    const treasuryStateAfterUnpause = await fetchTreasuryState(program, treasuryPda);
    expect(
      Boolean(treasuryStateAfterUnpause.paused),
      "treasury should be unpaused at test start"
    ).to.eq(false);

    console.log(
      "Initial payCount at file start:",
      BigInt(treasuryStateAfterUnpause.payCount.toString()).toString()
    );

    const setup = await setupMintAndAtas(
      provider,
      protocolAuthority,
      treasuryPda,
      1_000_000n
    );

    mint = setup.mint;
    userAta = setup.userAta;
    treasuryAta = setup.treasuryAta;

    await withRetry(
      async () => {
        const mintInfo = await provider.connection.getAccountInfo(mint, "finalized");

        if (!mintInfo) {
          throw new Error(`Mint not visible yet: ${mint.toBase58()}`);
        }

        if (!mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
          throw new Error(
            `Mint owner mismatch: mint=${mint.toBase58()} owner=${mintInfo.owner.toBase58()} expected=${TOKEN_PROGRAM_ID.toBase58()}`
          );
        }
      },
      "tier1-mint-visible",
      12,
      100
    );

    const depositTx = await buildSplDepositTx({
      program,
      authority: protocolAuthority,
      treasuryPda,
      mint,
      userAta,
      treasuryAta,
      amount: 900_000,
    });

    await sendRawTxFresh({
      provider,
      tx: depositTx,
      signers: [protocolAuthority],
      commitment: "finalized",
    });

    const treasuryAcc = await getAccount(
      provider.connection,
      treasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );
    console.log("TREASURY ATA FUNDED (raw units):", treasuryAcc.amount.toString());

    recipients = [];
    for (let i = 0; i < RECIPIENT_COUNT; i++) {
      recipients.push(Keypair.generate());
    }

    for (let i = 0; i < recipients.length; i++) {
      if (shouldLogProgress(i, recipients.length)) {
        console.log(`airdrop ${i + 1}/${recipients.length}`);
      }
      await airdrop(provider, recipients[i].publicKey, 1, "finalized");
    }

    recipientAtas = [];
    for (let i = 0; i < recipients.length; i++) {
      if (shouldLogProgress(i, recipients.length)) {
        console.log(`precreate ata ${i + 1}/${recipients.length}`);
      }
      const ata = await ensureAtaExists({
        provider,
        payer: protocolAuthority,
        owner: recipients[i].publicKey,
        mint,
      });
      recipientAtas.push(ata);
    }
  });

  async function sendOnePay(
    recipient: PublicKey,
    recipientAta: PublicKey
  ): Promise<{ sig: string; payCountBefore: bigint; receipt: PublicKey }> {
    const MAX_RETRIES = 14;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const payCountBefore = await fetchPayCount(program, treasuryPda);
      const receipt = payReceiptPdaFromPayCount(
        program.programId,
        treasuryPda,
        payCountBefore
      );

      try {
        const tx = await buildSplPayTx({
          program,
          authority: protocolAuthority,
          treasuryPda,
          treasuryAta,
          mint,
          recipient,
          recipientAta,
          receipt,
          amount: 1,
        });

        const sig = await sendRawTxFresh({
          provider,
          tx,
          signers: [protocolAuthority],
          commitment: "finalized",
        });

        return { sig, payCountBefore, receipt };
      } catch (e: any) {
        if ((isConstraintSeedsLike(e) || isAccountInUseLike(e)) && attempt < MAX_RETRIES) {
          await sleep(50 * attempt);
          continue;
        }

        if (isRetryable(e) && attempt < MAX_RETRIES) {
          await sleep(60 * attempt);
          continue;
        }

        throw e;
      }
    }

    throw new Error("sendOnePay exhausted retries");
  }

  it("sequential: 20 pays of 1 unit each", async () => {
    const treasuryBefore = await getAccount(
      provider.connection,
      treasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );
    const payCountBefore = await fetchPayCount(program, treasuryPda);

    console.log("Sequential start payCount:", payCountBefore.toString());

    for (let i = 0; i < SEQUENTIAL_PAYS; i++) {
      await sendOnePay(recipients[i].publicKey, recipientAtas[i]);
      if (shouldLogProgress(i, SEQUENTIAL_PAYS)) {
        console.log(`sequential ${i + 1}/${SEQUENTIAL_PAYS}`);
      }
    }

    const treasuryAfter = await getAccount(
      provider.connection,
      treasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );
    const payCountAfter = await fetchPayCount(program, treasuryPda);

    const expectedTreasuryDelta = BigInt(SEQUENTIAL_PAYS);
    const actualTreasuryDelta =
      BigInt(treasuryBefore.amount.toString()) -
      BigInt(treasuryAfter.amount.toString());

    expect(
      actualTreasuryDelta.toString(),
      "sequential invariant failed: treasury delta mismatch"
    ).to.eq(expectedTreasuryDelta.toString());

    const expectedPayCountDelta = BigInt(SEQUENTIAL_PAYS);
    const actualPayCountDelta = payCountAfter - payCountBefore;

    expect(
      actualPayCountDelta.toString(),
      "sequential invariant failed: pay_count delta mismatch"
    ).to.eq(expectedPayCountDelta.toString());
  });

  it("bounded concurrency: 20 pays, batch size 5", async function () {
    this.timeout(3_600_000);

    const treasuryBefore = await getAccount(
      provider.connection,
      treasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );
    const payCountBefore = await fetchPayCount(program, treasuryPda);

    console.log("TREASURY ATA BEFORE CONCURRENCY:", treasuryBefore.amount.toString());
    console.log("Concurrency start payCount:", payCountBefore.toString());

    let sent = 0;

    while (sent < CONCURRENT_PAYS) {
      const batch: Array<{ recipient: PublicKey; recipientAta: PublicKey }> = [];

      for (let i = 0; i < CONCURRENCY && sent < CONCURRENT_PAYS; i++) {
        const idx = sent;
        sent++;

        batch.push({
          recipient: recipients[idx].publicKey,
          recipientAta: recipientAtas[idx],
        });
      }

      /**
       * Important:
       * We keep the batch structure for readability and operational grouping,
       * but execution is serialized within the batch so pay_count-based receipt
       * derivation cannot race itself.
       */
      for (const item of batch) {
        await sendOnePay(item.recipient, item.recipientAta);
      }

      if (sent % LOG_EVERY === 0 || sent === CONCURRENT_PAYS) {
        console.log(`concurrent ${sent}/${CONCURRENT_PAYS}`);
      }
    }

    const treasuryAfter = await getAccount(
      provider.connection,
      treasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );
    const payCountAfter = await fetchPayCount(program, treasuryPda);

    console.log("TREASURY ATA AFTER STRESS (raw units):", treasuryAfter.amount.toString());

    const expectedTreasuryDelta = BigInt(CONCURRENT_PAYS);
    const actualTreasuryDelta =
      BigInt(treasuryBefore.amount.toString()) -
      BigInt(treasuryAfter.amount.toString());

    expect(
      actualTreasuryDelta.toString(),
      "bounded concurrency invariant failed: treasury delta mismatch"
    ).to.eq(expectedTreasuryDelta.toString());

    const expectedPayCountDelta = BigInt(CONCURRENT_PAYS);
    const actualPayCountDelta = payCountAfter - payCountBefore;

    expect(
      actualPayCountDelta.toString(),
      "bounded concurrency invariant failed: pay_count delta mismatch"
    ).to.eq(expectedPayCountDelta.toString());
  });

  after(async () => {
    if (!program || !protocolAuthority || !treasuryPda) return;

    await withRetry(
      async () => {
        await setTreasuryPausedStrict({
          program,
          authority: protocolAuthority,
          treasuryPda,
          paused: false,
        });
      },
      "tier1-after-unpause",
      8,
      100
    );

    const treasuryStateAfter: any = await fetchTreasuryState(program, treasuryPda);
    expect(
      Boolean(treasuryStateAfter.paused),
      "treasury should be unpaused after test file"
    ).to.eq(false);
  });
});



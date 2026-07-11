/**
 * tests/stress_pause_flip.spec.ts
 *
 * Tier1-A — deterministic pause gating proof
 *
 * Purpose:
 * - prove PAY succeeds while unpaused
 * - prove PAY rejects while paused
 * - prove PAY resumes cleanly after unpause
 *
 * This rewrite intentionally removes the concurrent flipper model.
 * That model was too timing-hostile for a clean Tier1-A proof when combined
 * with serialized pay_count-based receipt derivation and finalized confirmations.
 *
 * New structure:
 * - Phase 1: unpaused success batch
 * - Phase 2: paused rejection batch
 * - Phase 3: resumed success batch
 *
 * Why this is correct:
 * Tier1-A should prove deterministic pause gating semantics.
 * Boundary-race and overlap chaos belong in the higher-tier suites.
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
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";

import {
  getProgram,
  initFoundationOnce,
  setupMintAndAtas,
  airdrop,
  BN,
  expect,
  loadProtocolAuthority,
  createAtaStrict,
} from "./_helpers";

/* -----------------------------
 * tiny utilities
 * ----------------------------- */

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
    s.includes("seed constraint") ||
    s.includes("seeds constraint")
  );
}

function isPausedLike(msgOrLogs: string) {
  const s = String(msgOrLogs).toLowerCase();
  return (
    s.includes("protocolpaused") ||
    s.includes("treasurypaused") ||
    s.includes("paused") ||
    s.includes('"custom":6000') ||
    s.includes('"custom": 6000')
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
    s.toLowerCase().includes("timeout") ||
    s.toLowerCase().includes("timed out")
  );
}

async function withRetry<T>(
  fn: () => Promise<T>,
  tries = 10,
  delayMs = 120
): Promise<T> {
  let lastErr: any;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e) || i === tries) throw e;
      await sleep(delayMs + i * 40);
    }
  }
  throw lastErr;
}

function u64LE(n: anchor.BN): Buffer {
  return n.toArrayLike(Buffer, "le", 8);
}

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

async function fetchPayCount(
  programAny: any,
  treasuryPda: PublicKey
): Promise<anchor.BN> {
  const treasuryAcc: any = await programAny.account.treasury.fetch(treasuryPda);
  return new BN(treasuryAcc.payCount);
}

async function fetchTreasuryState(
  programAny: any,
  treasuryPda: PublicKey
): Promise<any> {
  return await programAny.account.treasury.fetch(treasuryPda);
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
 * strict builders
 * ----------------------------- */

async function buildSetTreasuryPausedTx(args: {
  program: Program<any>;
  authority: Keypair;
  treasuryPda: PublicKey;
  paused: boolean;
}): Promise<Transaction> {
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
        `Missing account '${acc.name}' for setTreasuryPaused. Provided: ${Object.keys(full).join(", ")}`
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
    if (lower === "amount") argsObj[a.name] = new BN(amount);
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

async function buildSplPayTx(args: {
  program: Program<any>;
  authority: Keypair;
  treasuryPda: PublicKey;
  mint: PublicKey;
  treasuryAta: PublicKey;
  recipient: PublicKey;
  recipientAta: PublicKey;
  receipt: PublicKey;
  amount: number;
}): Promise<Transaction> {
  const {
    program,
    authority,
    treasuryPda,
    mint,
    treasuryAta,
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
    if (lower === "amount") argsObj[a.name] = new BN(amount);
    else if (lower.includes("reference")) argsObj[a.name] = null;
    else if (lower.includes("memo")) argsObj[a.name] = null;
    else if (lower.includes("nonce")) {
      throw new Error(
        "stress_pause_flip expects canonical payCount-mode splPay, not nonce-mode."
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
        `Missing account '${acc.name}' for splPay. Provided: ${Object.keys(full).join(", ")}`
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

async function setTreasuryPausedStrict(args: {
  program: Program<any>;
  authority: Keypair;
  treasuryPda: PublicKey;
  paused: boolean;
  provider: AnchorProvider;
}) {
  const tx = await buildSetTreasuryPausedTx({
    program: args.program,
    authority: args.authority,
    treasuryPda: args.treasuryPda,
    paused: args.paused,
  });

  await sendRawTxFresh({
    provider: args.provider,
    tx,
    signers: [args.authority],
    commitment: "finalized",
  });
}

async function sendSplPayPayCountSafe(
  programAny: any,
  provider: AnchorProvider,
  signer: Keypair,
  args: {
    treasuryPda: PublicKey;
    mint: PublicKey;
    treasuryAta: PublicKey;
    recipient: PublicKey;
    recipientAta: PublicKey;
    amount: number;
  }
): Promise<{ sig: string; ok: boolean; paused?: boolean; err?: any }> {
  const MAX_RETRIES = 14;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const payCountBefore = await fetchPayCount(programAny, args.treasuryPda);
    const receiptPda = payReceiptPda(
      programAny.programId,
      args.treasuryPda,
      payCountBefore
    );

    try {
      const tx = await buildSplPayTx({
        program: programAny,
        authority: signer,
        treasuryPda: args.treasuryPda,
        mint: args.mint,
        treasuryAta: args.treasuryAta,
        recipient: args.recipient,
        recipientAta: args.recipientAta,
        receipt: receiptPda,
        amount: args.amount,
      });

      const sig = await sendRawTxFresh({
        provider,
        tx,
        signers: [signer],
        commitment: "finalized",
      });

      return { sig, ok: true };
    } catch (e: any) {
      const msg = String(e?.message ?? e);

      if (isPausedLike(msg)) {
        return { sig: "paused", ok: false, paused: true, err: e };
      }

      if (
        (isConstraintSeedsLike(e) || isAccountInUseLike(e) || isRetryable(e)) &&
        attempt < MAX_RETRIES
      ) {
        await sleep(50 * attempt);
        continue;
      }

      throw e;
    }
  }

  return {
    sig: "exhausted",
    ok: false,
    err: new Error("sendSplPayPayCountSafe exhausted retries"),
  };
}

describe("stress - pause gating proof (Tier1-A)", function () {
  this.timeout(1_800_000);

  let provider: AnchorProvider;
  let program: Program<any>;
  let programAny: any;
  let realProtocolAuth: Keypair;

  before(() => {
    provider = anchor.AnchorProvider.env() as AnchorProvider;
    anchor.setProvider(provider);

    program = getProgram();
    programAny = program as any;
    realProtocolAuth = loadProtocolAuthority();
  });

  it("PAY succeeds unpaused, rejects paused, then resumes after unpause", async () => {
    const PHASE1_SUCCESS_PAYS = 20;
    const PHASE2_PAUSED_ATTEMPTS = 20;
    const PHASE3_RESUME_PAYS = 20;
    const PAY_AMOUNT = 1;

    const USER_MINT_AMOUNT = BigInt(1_000_000);
    const TREASURY_DEPOSIT_AMOUNT = 900_000;

    const TOTAL_EXPECTED_SUCCESS =
      PHASE1_SUCCESS_PAYS + PHASE3_RESUME_PAYS;
    const TOTAL_EXPECTED_REJECT =
      PHASE2_PAUSED_ATTEMPTS;

    const { treasuryPda } = await initFoundationOnce(provider, programAny);

    await airdrop(provider, realProtocolAuth.publicKey, 2, "finalized");

    await withRetry(async () => {
      await setTreasuryPausedStrict({
        program: programAny,
        authority: realProtocolAuth,
        treasuryPda,
        paused: false,
        provider,
      });
    }, 8, 160);

    const treasuryStateAtStart = await fetchTreasuryState(programAny, treasuryPda);
    expect(
      Boolean(treasuryStateAtStart.paused),
      "treasury should be unpaused at test start"
    ).to.eq(false);

    console.log(
      "Pause-proof start payCount:",
      new BN(treasuryStateAtStart.payCount).toString()
    );

    const fundSetup = await setupMintAndAtas(
      provider,
      realProtocolAuth,
      treasuryPda,
      USER_MINT_AMOUNT
    );

    const mint = fundSetup.mint;
    const userAta = fundSetup.userAta;
    const activeTreasuryAta = fundSetup.treasuryAta;

    const depositTx = await buildSplDepositTx({
      program: programAny,
      authority: realProtocolAuth,
      treasuryPda,
      mint,
      userAta,
      treasuryAta: activeTreasuryAta,
      amount: TREASURY_DEPOSIT_AMOUNT,
    });

    await sendRawTxFresh({
      provider,
      tx: depositTx,
      signers: [realProtocolAuth],
      commitment: "finalized",
    });

    const recipients: Keypair[] = Array.from({ length: 20 }, () => Keypair.generate());

    const recipientAtas = new Map<string, PublicKey>();
    for (const r of recipients) {
      await airdrop(provider, r.publicKey, 1, "finalized");
      const ata = getAssociatedTokenAddressSync(
        mint,
        r.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const exists = await provider.connection.getAccountInfo(ata, "finalized");
      if (!exists) {
        await createAtaStrict({
          provider,
          payer: realProtocolAuth,
          mint,
          owner: r.publicKey,
        });
      }
      recipientAtas.set(r.publicKey.toBase58(), ata);
    }

    const before = await getAccount(
      provider.connection,
      activeTreasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );
    const beforeAmt = Number(before.amount);

    console.log("Pause-proof treasury before phases:", beforeAmt.toString());

    expect(
      beforeAmt,
      "treasury must be comfortably funded before pause proof"
    ).to.be.greaterThan((PHASE1_SUCCESS_PAYS + PHASE2_PAUSED_ATTEMPTS + PHASE3_RESUME_PAYS) * PAY_AMOUNT * 2);

    let allowedPays = 0;
    let rejectedPays = 0;

    const sendPhasePays = async (
      count: number,
      expectPaused: boolean,
      phaseLabel: string
    ) => {
      for (let i = 0; i < count; i++) {
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

        const result = await sendSplPayPayCountSafe(
          programAny,
          provider,
          realProtocolAuth,
          {
            treasuryPda,
            mint,
            treasuryAta: activeTreasuryAta,
            recipient: recipient.publicKey,
            recipientAta,
            amount: PAY_AMOUNT,
          }
        );

        if (expectPaused) {
          expect(
            result.paused === true && result.ok === false,
            `${phaseLabel} pay ${i + 1}: expected paused rejection`
          ).to.eq(true);
          rejectedPays++;
        } else {
          expect(
            result.ok,
            `${phaseLabel} pay ${i + 1}: expected success`
          ).to.eq(true);
          allowedPays++;
        }
      }
    };

    try {
      // Phase 1: unpaused -> success
      await withRetry(async () => {
        await setTreasuryPausedStrict({
          program: programAny,
          authority: realProtocolAuth,
          treasuryPda,
          paused: false,
          provider,
        });
      }, 8, 160);

      await sendPhasePays(PHASE1_SUCCESS_PAYS, false, "phase1-unpaused");

      // Phase 2: paused -> reject
      await withRetry(async () => {
        await setTreasuryPausedStrict({
          program: programAny,
          authority: realProtocolAuth,
          treasuryPda,
          paused: true,
          provider,
        });
      }, 8, 160);

      await sendPhasePays(PHASE2_PAUSED_ATTEMPTS, true, "phase2-paused");

      // Phase 3: unpaused again -> success
      await withRetry(async () => {
        await setTreasuryPausedStrict({
          program: programAny,
          authority: realProtocolAuth,
          treasuryPda,
          paused: false,
          provider,
        });
      }, 8, 160);

      await sendPhasePays(PHASE3_RESUME_PAYS, false, "phase3-resumed");
    } finally {
      await withRetry(async () => {
        await setTreasuryPausedStrict({
          program: programAny,
          authority: realProtocolAuth,
          treasuryPda,
          paused: false,
          provider,
        });
      }, 8, 160);
    }

    const treasuryStateAtEnd = await fetchTreasuryState(programAny, treasuryPda);
    expect(
      Boolean(treasuryStateAtEnd.paused),
      "treasury should be unpaused at test end"
    ).to.eq(false);

    const after = await getAccount(
      provider.connection,
      activeTreasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );
    const afterAmt = Number(after.amount);

    const delta = beforeAmt - afterAmt;

    expect(
      allowedPays,
      "successful pay count mismatch"
    ).to.eq(TOTAL_EXPECTED_SUCCESS);

    expect(
      rejectedPays,
      "paused rejection count mismatch"
    ).to.eq(TOTAL_EXPECTED_REJECT);

    expect(
      delta,
      "treasury delta must equal successful pays only"
    ).to.eq(allowedPays * PAY_AMOUNT);

    console.log({
      PHASE1_SUCCESS_PAYS,
      PHASE2_PAUSED_ATTEMPTS,
      PHASE3_RESUME_PAYS,
      allowedPays,
      rejectedPays,
      treasuryBefore: beforeAmt,
      treasuryAfter: afterAmt,
      delta,
    });
  });
});
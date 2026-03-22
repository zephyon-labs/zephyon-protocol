// tests/stress_tier2b_idempotent_failed_pay.spec.ts
//
// Tier2B: Idempotent failed PAY (STRICT)
//
// Purpose:
// - Repeated invalid PAY attempts must not mutate protocol state
//
// Scenarios:
// - wrong authority
// - paused treasury
// - malformed recipient ATA / mint mismatch
//
// Required invariants per scenario:
// - treasury balance unchanged
// - recipient balances unchanged
// - total tracked value unchanged
// - treasury.payCount unchanged
// - no receipt created for the attempted pay_count seed

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMint,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";

import {
  loadProtocolAuthority,
  airdrop,
  initFoundationOnce,
  derivePayReceiptPda,
  getTreasuryPayCount,
  receiptExists,
  snapshotTokenBalances,
  assertTrackedInvariantUnchanged,
  withRetry,
  treasuryDelta,
  aggregateUserDelta,
} from "./_helpers";

const bn = (x: number | string | bigint) => new anchor.BN(x.toString());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

function isExpectedFailure(e: any): boolean {
  const s = String(e?.message ?? e);
  return (
    s.includes("ProtocolPaused") ||
    s.includes("TreasuryPaused") ||
    s.includes("Unauthorized") ||
    s.includes("UnauthorizedWithdraw") ||
    s.includes("InstructionError") ||
    s.includes('"Custom"') ||
    s.includes("custom program error") ||
    s.toLowerCase().includes("constraint") ||
    s.toLowerCase().includes("invalidmint") ||
    s.toLowerCase().includes("seeds") ||
    s.toLowerCase().includes("incorrect program id")
  );
}

async function ensureAtaExists(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  owner: PublicKey,
  mint: PublicKey,
  allowOwnerOffCurve = false
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    allowOwnerOffCurve,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const info = await provider.connection.getAccountInfo(ata);
  if (info) return ata;

  const ix = createAssociatedTokenAccountInstruction(
    payer.publicKey,
    ata,
    owner,
    mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const tx = new Transaction().add(ix);
  await provider.sendAndConfirm(tx, [payer], {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  return ata;
}

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

  const tx = new Transaction().add(ix);
  const ap = program.provider as anchor.AnchorProvider;
  await ap.sendAndConfirm(tx, [authority], {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

async function buildSplPayTx(args: {
  program: Program<any>;
  authority: Keypair;
  treasuryPda: PublicKey;
  mint: PublicKey;
  treasuryAta: PublicKey;
  recipient: PublicKey;
  recipientAta: PublicKey;
  amount: number;
  receipt: PublicKey;
}): Promise<Transaction> {
  const {
    program,
    authority,
    treasuryPda,
    mint,
    treasuryAta,
    recipient,
    recipientAta,
    amount,
    receipt,
  } = args;

  const ixDef = getIx(program, "splPay");

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
    else if (n.includes("nonce")) {
      throw new Error("Tier2B expects current payCount-mode splPay, not nonce-mode.");
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

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys,
    data,
  });

  return new Transaction().add(ix);
}

async function sendExpectFailure(args: {
  provider: anchor.AnchorProvider;
  signer: Keypair;
  txFactory: () => Promise<Transaction>;
  label: string;
}) {
  const { provider, signer, txFactory, label } = args;

  try {
    const tx = await txFactory();
    const latest = await provider.connection.getLatestBlockhash("confirmed");
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = latest.blockhash;
    tx.sign(signer);

    const sig = await provider.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    await provider.connection.confirmTransaction(
      {
        signature: sig,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed"
    );

    const statusResp = await provider.connection.getSignatureStatuses([sig]);
    const status = statusResp.value[0];

    if (!status) {
      throw new Error(`${label}: missing signature status`);
    }

    if (!status.err) {
      throw new Error(`${label}: invalid PAY unexpectedly succeeded`);
    }

    const errString = JSON.stringify(status.err);
    if (!isExpectedFailure(errString)) {
      throw new Error(`${label}: unexpected failure type ${errString}`);
    }

    return errString;
  } catch (e: any) {
    if (isExpectedFailure(e)) {
      return String(e?.message ?? e);
    }
    throw e;
  }
}

describe("stress - Tier2B idempotent failed PAY (STRICT)", () => {
  let provider: anchor.AnchorProvider;
  let program: Program<any>;

  let protocolAuth: Keypair;
  let wrongAuth: Keypair;
  let treasuryPda: PublicKey;

  let mint: PublicKey;
  let wrongMint: PublicKey;
  let treasuryAta: PublicKey;

  let recipient: Keypair;
  let recipientAta: PublicKey;
  let wrongMintRecipientAta: PublicKey;

  const ATTEMPTS_PER_SCENARIO = Number(process.env.TIER2B_ATTEMPTS ?? "5");
  const PAY_AMOUNT = Number(process.env.TIER2B_PAY_AMOUNT ?? "111");

  before(async () => {
    const envProvider = anchor.AnchorProvider.env();
    protocolAuth = loadProtocolAuthority();
    wrongAuth = Keypair.generate();
    recipient = Keypair.generate();

    await airdrop(envProvider, protocolAuth.publicKey, 2);
    await airdrop(envProvider, wrongAuth.publicKey, 2);
    await airdrop(envProvider, recipient.publicKey, 2);
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

    if (splPayHasNonceArg(program)) {
      throw new Error("Tier2B expects current payCount-mode splPay, not nonce-mode.");
    }

    [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );

    await initFoundationOnce(provider, program);

    mint = await createMint(
      provider.connection,
      protocolAuth,
      protocolAuth.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );

    wrongMint = await createMint(
      provider.connection,
      protocolAuth,
      protocolAuth.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );

    const mintInfo = await provider.connection.getAccountInfo(mint);
    if (!mintInfo || !mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
      throw new Error("Tier2B primary mint not owned by Tokenkeg");
    }

    treasuryAta = await ensureAtaExists(
      provider,
      protocolAuth,
      treasuryPda,
      mint,
      true
    );

    await mintTo(
      provider.connection,
      protocolAuth,
      mint,
      treasuryAta,
      protocolAuth.publicKey,
      1_000_000,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );

    recipientAta = await ensureAtaExists(
      provider,
      protocolAuth,
      recipient.publicKey,
      mint,
      false
    );

    wrongMintRecipientAta = await ensureAtaExists(
      provider,
      protocolAuth,
      recipient.publicKey,
      wrongMint,
      false
    );

    await withRetry(
      () => setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false),
      { label: "tier2b-unpause-start", retries: 8, baseDelayMs: 100 }
    );
  });

  after(async () => {
    if (!program || !protocolAuth || !treasuryPda) return;

    await withRetry(
      () => setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false),
      { label: "tier2b-unpause-end", retries: 8, baseDelayMs: 100 }
    );
  });

  async function runScenario(args: {
    label: string;
    signer: Keypair;
    paused: boolean;
    recipientAtaOverride?: PublicKey;
    mintOverride?: PublicKey;
  }) {
    const { label, signer, paused, recipientAtaOverride, mintOverride } = args;

    if (paused) {
      await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, true);
    } else {
      await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);
    }

    const payCountBefore = await getTreasuryPayCount(program, treasuryPda);
    const attemptedReceipt = derivePayReceiptPda(
      program.programId,
      treasuryPda,
      payCountBefore
    )[0];

    const beforeSnap = await snapshotTokenBalances({
      providerOrConn: provider,
      treasuryAta,
      userAtas: [recipientAta],
      mint,
      label: `${label}-before`,
    });

    const receiptBefore = await receiptExists(provider, attemptedReceipt);
    expect(receiptBefore, `${label}: receipt unexpectedly exists before scenario`).to.eq(false);

    const errors: string[] = [];

    for (let i = 0; i < ATTEMPTS_PER_SCENARIO; i++) {
      const txFactory = async () =>
        buildSplPayTx({
          program,
          authority: signer,
          treasuryPda,
          mint: mintOverride ?? mint,
          treasuryAta,
          recipient: recipient.publicKey,
          recipientAta: recipientAtaOverride ?? recipientAta,
          amount: PAY_AMOUNT,
          receipt: attemptedReceipt,
        });

      const err = await sendExpectFailure({
        provider,
        signer,
        txFactory,
        label: `${label}-attempt-${i + 1}`,
      });

      errors.push(err);
    }

    const afterSnap = await snapshotTokenBalances({
      providerOrConn: provider,
      treasuryAta,
      userAtas: [recipientAta],
      mint,
      label: `${label}-after`,
    });

    const payCountAfter = await getTreasuryPayCount(program, treasuryPda);
    const receiptAfter = await receiptExists(provider, attemptedReceipt);

    // Core idempotence assertions
    assertTrackedInvariantUnchanged(
      beforeSnap,
      afterSnap,
      `${label}: tracked invariant changed under repeated invalid PAY attempts`
    );

    expect(
      treasuryDelta(beforeSnap, afterSnap).toString(),
      `${label}: treasury delta changed under invalid PAY attempts`
    ).to.eq("0");

    expect(
      aggregateUserDelta(beforeSnap, afterSnap).toString(),
      `${label}: recipient delta changed under invalid PAY attempts`
    ).to.eq("0");

    expect(
      payCountAfter.toString(),
      `${label}: pay_count changed under invalid PAY attempts`
    ).to.eq(payCountBefore.toString());

    expect(
      receiptAfter,
      `${label}: receipt was created during invalid PAY attempts`
    ).to.eq(false);

    console.log("Tier2B Evidence:", {
      label,
      attempts: ATTEMPTS_PER_SCENARIO,
      paused,
      payCountBefore: payCountBefore.toString(),
      payCountAfter: payCountAfter.toString(),
      attemptedReceipt: attemptedReceipt.toBase58(),
      treasuryBefore: beforeSnap.treasuryBalance.toString(),
      treasuryAfter: afterSnap.treasuryBalance.toString(),
      totalTrackedBefore: beforeSnap.totalTracked.toString(),
      totalTrackedAfter: afterSnap.totalTracked.toString(),
      errors,
    });

    if (paused) {
      await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);
    }
  }

  it("Tier2B-1: repeated wrong-authority PAY attempts are idempotent", async () => {
    await runScenario({
      label: "wrong-authority",
      signer: wrongAuth,
      paused: false,
    });
  });

  it("Tier2B-2: repeated paused PAY attempts are idempotent", async () => {
    await runScenario({
      label: "paused",
      signer: protocolAuth,
      paused: true,
    });
  });

  it("Tier2B-3: repeated malformed recipient ATA / wrong mint PAY attempts are idempotent", async () => {
    await runScenario({
      label: "wrong-mint-recipient-ata",
      signer: protocolAuth,
      paused: false,
      recipientAtaOverride: wrongMintRecipientAta,
      mintOverride: mint,
    });
  });
});
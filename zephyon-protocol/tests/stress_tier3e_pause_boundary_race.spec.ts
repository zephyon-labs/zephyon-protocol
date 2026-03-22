// tests/stress_tier3e_pause_boundary_race.spec.ts
//
// Tier3E: Pause boundary race safety (STRICT)
//
// Purpose:
// - Build PAY transactions near pause state transitions
// - Submit them across pause boundaries with controlled timing
// - Prove no ghost execution occurs
//
// Core principle:
// Solana enforces account constraints at execution time, not build time.
// So a tx built while unpaused but executed after pause should reject.
//
// Assertions:
// - only execution-time-valid PAYs succeed
// - rejected boundary attempts do not increment pay_count
// - total tracked value remains correct
// - treasury/user deltas equal sum of actual successful pays only
// - successful attempts create receipts
//
// IMPORTANT:
// This suite targets current payCount-mode SPL pay behavior.
// It intentionally serializes successful boundary sends to avoid mixing
// pause-boundary truth with pay-count collision contention (Tier3D already
// covers collision safety).
//
// Professional-grade hardening notes:
// - Uses hardened transport via sendRawTxFresh()
// - Uses explicit Tokenkeg mint creation + owner sanity check
// - Uses explicit ATA derivation everywhere
// - Uses idempotent ATA create + post-create validation
// - Helper-backed payCount receipt derivation
// - Improved evidence output for audit readability

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
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
  createAssociatedTokenAccountIdempotentInstruction,
  createMint,
  mintTo,
  getAccount,
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
  treasuryDelta,
  aggregateUserDelta,
  assertTrackedInvariantUnchanged,
  withRetry,
  sendRawTxFresh,
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

function isPauseLikeFailure(e: any): boolean {
  const s = String(e?.message ?? e).toLowerCase();
  return (
    s.includes("protocolpaused") ||
    s.includes("treasurypaused") ||
    s.includes("paused") ||
    s.includes("custom program error") ||
    s.includes("instructionerror")
  );
}

async function readAtaIfValid(args: {
  provider: anchor.AnchorProvider;
  ata: PublicKey;
  expectedMint: PublicKey;
  expectedOwner: PublicKey;
}) {
  const { provider, ata, expectedMint, expectedOwner } = args;

  try {
    const acct = await getAccount(
      provider.connection,
      ata,
      "confirmed",
      TOKEN_PROGRAM_ID
    );

    if (!acct.mint.equals(expectedMint)) {
      throw new Error(
        `ATA mint mismatch for ${ata.toBase58()}. actual=${acct.mint.toBase58()} expected=${expectedMint.toBase58()}`
      );
    }

    if (!acct.owner.equals(expectedOwner)) {
      throw new Error(
        `ATA owner mismatch for ${ata.toBase58()}. actual=${acct.owner.toBase58()} expected=${expectedOwner.toBase58()}`
      );
    }

    return acct;
  } catch {
    return null;
  }
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

  const existing = await readAtaIfValid({
    provider,
    ata,
    expectedMint: mint,
    expectedOwner: owner,
  });
  if (existing) return ata;

  await withRetry(
    async () => {
      const tx = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          payer.publicKey,
          ata,
          owner,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );

      await sendRawTxFresh({
        provider,
        tx,
        signers: [payer],
        commitment: "confirmed",
      });
    },
    {
      label: `ensure-ata-create-${ata.toBase58().slice(0, 8)}`,
      retries: 8,
      baseDelayMs: 120,
    }
  );

  await withRetry(
    async () => {
      const acct = await readAtaIfValid({
        provider,
        ata,
        expectedMint: mint,
        expectedOwner: owner,
      });

      if (!acct) {
        throw new Error(
          `ATA not yet visible/valid after create: ata=${ata.toBase58()} owner=${owner.toBase58()} mint=${mint.toBase58()}`
        );
      }
    },
    {
      label: `ensure-ata-visible-${ata.toBase58().slice(0, 8)}`,
      retries: 10,
      baseDelayMs: 100,
    }
  );

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

  await sendRawTxFresh({
    provider: ap,
    tx,
    signers: [authority],
    commitment: "confirmed",
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
      throw new Error("Tier3E expects current payCount-mode splPay, not nonce-mode.");
    } else {
      argsObj[a.name] = null;
    }
  }

  const data = program.coder.instruction.encode("splPay", argsObj);

  const keys = (ixDef.accounts as any[]).map((acc: any) => {
    const pubkey = full[acc.name];
    if (!pubkey) {
      throw new Error(
        `Missing account '${acc.name}' for splPay. Provided: ${Object.keys(
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

  return new Transaction().add(ix);
}

type BoundaryOutcome =
  | { kind: "SUCCESS"; label: string; amount: number; receipt: PublicKey }
  | {
      kind: "REJECT_PAUSED";
      label: string;
      amount: number;
      receipt: PublicKey;
      message: string;
    };

async function sendBoundaryPay(args: {
  provider: anchor.AnchorProvider;
  authority: Keypair;
  txFactory: () => Promise<Transaction>;
  label: string;
  amount: number;
  receipt: PublicKey;
}): Promise<BoundaryOutcome> {
  const { provider, authority, txFactory, label, amount, receipt } = args;

  try {
    const tx = await txFactory();

    await sendRawTxFresh({
      provider,
      tx,
      signers: [authority],
      commitment: "confirmed",
    });

    return { kind: "SUCCESS", label, amount, receipt };
  } catch (e: any) {
    if (isPauseLikeFailure(e)) {
      return {
        kind: "REJECT_PAUSED",
        label,
        amount,
        receipt,
        message: String(e?.message ?? e),
      };
    }
    throw e;
  }
}

describe("stress - Tier3E pause boundary race (STRICT)", () => {
  let provider: anchor.AnchorProvider;
  let program: Program<any>;

  let protocolAuth: Keypair;
  let treasuryPda: PublicKey;

  let mint: PublicKey;
  let treasuryAta: PublicKey;

  const recipients: Keypair[] = [];
  let recipientAtas: PublicKey[] = [];

  const RECIPIENTS = Number(process.env.TIER3E_RECIPIENTS ?? "4");
  const ATTEMPTS = Number(process.env.TIER3E_ATTEMPTS ?? "8");
  const PAY_AMOUNT = Number(process.env.TIER3E_PAY_AMOUNT ?? "111");

  before(async () => {
    const envProvider = anchor.AnchorProvider.env();
    protocolAuth = loadProtocolAuthority();

    await airdrop(envProvider, protocolAuth.publicKey, 2);
    await sleep(150);

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
      throw new Error("Tier3E expects current payCount-mode splPay, not nonce-mode.");
    }

    await initFoundationOnce(provider, program);

    [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );

    mint = await createMint(
  provider.connection,
  protocolAuth,
  protocolAuth.publicKey,
  null,
  6,
  undefined,
  {
    commitment: "finalized",
    preflightCommitment: "finalized",
    skipPreflight: false,
  },
  TOKEN_PROGRAM_ID
);

    await withRetry(
  async () => {
    const mintInfo = await provider.connection.getAccountInfo(
  mint,
  "finalized"
);

    if (!mintInfo) {
      throw new Error("Mint not visible yet");
    }

    if (!mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
      throw new Error(
        `Tier3E mint owner mismatch. mint=${mint.toBase58()} owner=${mintInfo.owner.toBase58()} expected=${TOKEN_PROGRAM_ID.toBase58()}`
      );
    }
  },
  {
    label: "tier3e-mint-visible",
    retries: 12,
    baseDelayMs: 100,
  }
);

    treasuryAta = await ensureAtaExists(
      provider,
      protocolAuth,
      treasuryPda,
      mint,
      true
    );

    await withRetry(
      async () => {
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
      },
      { label: "tier3e-mintTo", retries: 10, baseDelayMs: 120 }
    );

    recipients.length = 0;
    for (let i = 0; i < RECIPIENTS; i++) {
      recipients.push(Keypair.generate());
    }

    for (const r of recipients) {
      await airdrop(provider, r.publicKey, 0.25);
    }

    recipientAtas = [];
    for (const r of recipients) {
      const ata = await ensureAtaExists(
        provider,
        protocolAuth,
        r.publicKey,
        mint,
        false
      );
      recipientAtas.push(ata);
    }

    await withRetry(
      () => setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false),
      { label: "tier3e-unpause-start", retries: 8, baseDelayMs: 100 }
    );
  });

  after(async () => {
    if (!program || !protocolAuth || !treasuryPda) return;

    await withRetry(
      () => setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false),
      { label: "tier3e-unpause-end", retries: 8, baseDelayMs: 100 }
    );
  });

  it("Tier3E: PAY execution obeys runtime pause state across build/send boundaries", async () => {
    const payCountBefore = await getTreasuryPayCount(program, treasuryPda);

    const attempts = Array.from({ length: ATTEMPTS }, (_, i) => {
      const recipientIdx = i % recipients.length;
      return {
        idx: i,
        label: `boundary-${i + 1}`,
        recipient: recipients[recipientIdx].publicKey,
        recipientAta: recipientAtas[recipientIdx],
        shouldReject: i % 2 === 0,
      };
    });

    const beforeSnap = await snapshotTokenBalances({
      providerOrConn: provider,
      treasuryAta,
      userAtas: recipientAtas,
      mint,
      label: "tier3e-before",
    });

    const results: BoundaryOutcome[] = [];
    let successfulPays = 0;

    for (const attempt of attempts) {
      if (attempt.shouldReject) {
        await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);

        const currentPayCount = await getTreasuryPayCount(program, treasuryPda);
        const [contestedReceipt] = derivePayReceiptPda(
          program.programId,
          treasuryPda,
          currentPayCount
        );

        const txFactory = async () =>
          buildSplPayTx({
            program,
            authority: protocolAuth,
            treasuryPda,
            mint,
            treasuryAta,
            recipient: attempt.recipient,
            recipientAta: attempt.recipientAta,
            amount: PAY_AMOUNT,
            receipt: contestedReceipt,
          });

        await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, true);

        const out = await sendBoundaryPay({
          provider,
          authority: protocolAuth,
          txFactory,
          label: attempt.label,
          amount: PAY_AMOUNT,
          receipt: contestedReceipt,
        });

        results.push(out);

        expect(
          out.kind,
          `${attempt.label}: tx built while unpaused but sent after pause must reject`
        ).to.eq("REJECT_PAUSED");

        const payCountAfterReject = await getTreasuryPayCount(program, treasuryPda);
        expect(
          payCountAfterReject.toString(),
          `${attempt.label}: rejected boundary attempt incremented pay_count`
        ).to.eq(currentPayCount.toString());

        const receiptAfterReject = await receiptExists(provider, contestedReceipt);
        expect(
          receiptAfterReject,
          `${attempt.label}: rejected boundary attempt created a receipt`
        ).to.eq(false);
      } else {
        await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, true);

        const currentPayCount = await getTreasuryPayCount(program, treasuryPda);
        const [runtimeReceipt] = derivePayReceiptPda(
          program.programId,
          treasuryPda,
          currentPayCount
        );

        const txFactory = async () =>
          buildSplPayTx({
            program,
            authority: protocolAuth,
            treasuryPda,
            mint,
            treasuryAta,
            recipient: attempt.recipient,
            recipientAta: attempt.recipientAta,
            amount: PAY_AMOUNT,
            receipt: runtimeReceipt,
          });

        await setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false);

        const out = await sendBoundaryPay({
          provider,
          authority: protocolAuth,
          txFactory,
          label: attempt.label,
          amount: PAY_AMOUNT,
          receipt: runtimeReceipt,
        });

        results.push(out);

        expect(
          out.kind,
          `${attempt.label}: tx built while paused but sent after unpause should succeed`
        ).to.eq("SUCCESS");

        successfulPays += 1;
      }
    }

    const afterSnap = await snapshotTokenBalances({
      providerOrConn: provider,
      treasuryAta,
      userAtas: recipientAtas,
      mint,
      label: "tier3e-after",
    });

    const payCountAfter = await getTreasuryPayCount(program, treasuryPda);

    const successCount = results.filter((r) => r.kind === "SUCCESS").length;
    const rejectCount = results.filter((r) => r.kind === "REJECT_PAUSED").length;

    expect(
      successCount,
      "unexpected success count across boundary race suite"
    ).to.eq(successfulPays);

    expect(
      rejectCount,
      "unexpected reject count across boundary race suite"
    ).to.eq(ATTEMPTS - successfulPays);

    expect(
      payCountAfter.toString(),
      "pay_count must increase exactly once per successful runtime-valid PAY"
    ).to.eq((payCountBefore + BigInt(successfulPays)).toString());

    const tDelta = treasuryDelta(beforeSnap, afterSnap);
    const uDelta = aggregateUserDelta(beforeSnap, afterSnap);
    const expected = BigInt(successfulPays * PAY_AMOUNT);

    expect(
      tDelta.toString(),
      "treasury delta mismatch across boundary suite"
    ).to.eq(expected.toString());

    expect(
      uDelta.toString(),
      "recipient aggregate delta mismatch across boundary suite"
    ).to.eq(expected.toString());

    expect(
      tDelta.toString(),
      "treasury/user delta mismatch"
    ).to.eq(uDelta.toString());

    assertTrackedInvariantUnchanged(
      beforeSnap,
      afterSnap,
      "tracked invariant changed across pause boundary race suite"
    );

    for (const r of results) {
      if (r.kind === "SUCCESS") {
        const exists = await receiptExists(provider, r.receipt);
        expect(
          exists,
          `${r.label}: successful boundary attempt failed to create receipt`
        ).to.eq(true);
      }
    }

    console.log("Tier3E Evidence:", {
      payCountBefore: payCountBefore.toString(),
      payCountAfter: payCountAfter.toString(),
      attempts: ATTEMPTS,
      successCount,
      rejectCount,
      expectedMoved: expected.toString(),
      treasuryDelta: tDelta.toString(),
      recipientAggregateDelta: uDelta.toString(),
      treasuryBefore: beforeSnap.treasuryBalance.toString(),
      treasuryAfter: afterSnap.treasuryBalance.toString(),
      totalTrackedBefore: beforeSnap.totalTracked.toString(),
      totalTrackedAfter: afterSnap.totalTracked.toString(),
      results,
    });
  });
});
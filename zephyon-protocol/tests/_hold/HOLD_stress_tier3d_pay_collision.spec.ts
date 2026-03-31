// HOLD — Tier3D PAY collision safety (STRICT)
//
// Status:
// - ON HOLD — setup-path instability (ATA provisioning / visibility)
// - Test does not consistently reach collision execution phase
// - Current failures occur in before() hook, not in PAY contention logic
//
// Interpretation:
// - This is NOT a confirmed protocol failure
// - This is a test harness / setup instability issue
//
// Reason for hold:
// - Prevents false negatives during audit-grade consolidation
// - Blocking signal is infrastructure, not invariant validation
//
// Resume criteria:
// - ATA creation path stabilized OR replaced
// - Deterministic setup confirmed (no TokenAccountNotFoundError)
// - Test consistently reaches PAY execution phase
//
// Next investigation target:
// - Identify whether failure is:
//   1) treasury ATA (off-curve)
//   2) recipient ATA
//   3) post-creation visibility timing
//
// Do NOT delete. This test is critical for:
// - pay_count collision safety
// - receipt uniqueness guarantees
// - audit-level concurrency validation
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// tests/stress_tier3d_pay_collision.spec.ts
//
// Tier3D: PAY collision safety (STRICT)

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
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
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
  aggregateUserDelta,
  treasuryDelta,
  assertTrackedInvariantUnchanged,
  withRetry,
  runBoundedJittered,
  sendRawTxFresh,
} from "./_helpers";

const bn = (x: number | string | bigint) => new anchor.BN(x.toString());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isPauseError(e: any): boolean {
  const s = String(e?.message ?? e);
  return (
    s.includes("TreasuryPaused") ||
    s.includes("ProtocolPaused") ||
    s.toLowerCase().includes("paused")
  );
}

function isCollisionLikeError(e: any): boolean {
  const raw = String(e?.message ?? e);
  const s = raw.toLowerCase();

  return (
    s.includes("accountinuse") ||
    s.includes("already in use") ||
    s.includes("account already") ||
    s.includes("initialized") ||
    s.includes("constraint") ||
    s.includes("seeds") ||
    s.includes("in use") ||
    raw.includes('"Custom":2006') ||
    raw.includes('"Custom": 2006') ||
    raw.includes('{"Custom":2006}') ||
    raw.includes('{"Custom": 2006}') ||
    raw.includes('Transaction failed: {"InstructionError":[0,{"Custom":2006}]}')
  );
}

type PayAttemptResult =
  | { kind: "SUCCESS"; who: string; amount: number }
  | { kind: "FAIL_EXPECTED"; who: string; amount: number; message: string };

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

async function waitForAccount(
  conn: anchor.web3.Connection,
  pubkey: PublicKey,
  label: string
) {
  await withRetry(
    async () => {
      const info = await conn.getAccountInfo(pubkey, "confirmed");
      if (!info) throw new Error(`${label} not visible yet: ${pubkey.toBase58()}`);
      return info;
    },
    { label, retries: 10, baseDelayMs: 150 }
  );
}

async function getOrCreateAtaStable(args: {
  conn: anchor.web3.Connection;
  payer: Keypair;
  mint: PublicKey;
  owner: PublicKey;
  allowOwnerOffCurve?: boolean;
  label: string;
}) {
  const {
    conn,
    payer,
    mint,
    owner,
    allowOwnerOffCurve = false,
    label,
  } = args;

  const ataObj = await withRetry(
    () =>
      getOrCreateAssociatedTokenAccount(
        conn,
        payer,
        mint,
        owner,
        allowOwnerOffCurve,
        "confirmed",
        undefined,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
    { label: `${label}-create`, retries: 8, baseDelayMs: 150 }
  );

  await waitForAccount(conn, ataObj.address, `${label}-visible`);
  return ataObj.address;
}

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
    provider: program.provider as anchor.AnchorProvider,
    tx: new Transaction().add(
      new TransactionInstruction({
        programId: program.programId,
        keys,
        data,
      })
    ),
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

  const ixDef = getIx(program, "spl_pay");

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
        "Tier3D is for payCount-mode only. IDL shows nonce-mode spl_pay."
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

  return new Transaction().add(
    new TransactionInstruction({
      programId: program.programId,
      keys,
      data,
    })
  );
}

async function sendPayCollisionAttempt(args: {
  provider: anchor.AnchorProvider;
  authority: Keypair;
  txFactory: () => Promise<Transaction>;
  who: string;
  amount: number;
}): Promise<PayAttemptResult> {
  const { provider, authority, txFactory, who, amount } = args;

  try {
    const tx = await txFactory();

    await sendRawTxFresh({
      provider,
      tx,
      signers: [authority],
      commitment: "confirmed",
    });

    return { kind: "SUCCESS", who, amount };
  } catch (e: any) {
    if (isPauseError(e) || isCollisionLikeError(e)) {
      return {
        kind: "FAIL_EXPECTED",
        who,
        amount,
        message: String(e?.message ?? e),
      };
    }
    throw e;
  }
}

describe("stress - Tier3D pay collision safety (STRICT)", () => {
  let provider: anchor.AnchorProvider;
  let program: Program<any>;

  let protocolAuth: Keypair;
  let treasuryPda: PublicKey;

  let mint: PublicKey;
  let treasuryAta: PublicKey;

  let recipient: Keypair;
  let recipientAta: PublicKey;

  const CONTENDERS = Number(process.env.TIER3D_CONTENDERS ?? "4");
  const PAY_AMOUNT = Number(process.env.TIER3D_PAY_AMOUNT ?? "111");

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
      throw new Error(
        "Tier3D is specifically for payCount-mode collision safety, but IDL indicates nonce-mode."
      );
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
      undefined,
      TOKEN_PROGRAM_ID
    );

    const mintInfo = await provider.connection.getAccountInfo(mint);
    if (!mintInfo) throw new Error("Mint account missing right after createMint()");
    if (!mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
      throw new Error(
        `Tier3D mint owner mismatch. mint=${mint.toBase58()} owner=${mintInfo.owner.toBase58()} expected Tokenkeg=${TOKEN_PROGRAM_ID.toBase58()}`
      );
    }

    treasuryAta = await getOrCreateAtaStable({
      conn: provider.connection,
      payer: protocolAuth,
      mint,
      owner: treasuryPda,
      allowOwnerOffCurve: true,
      label: "tier3d-treasury-ata",
    });

    await withRetry(
      () =>
        mintTo(
          provider.connection,
          protocolAuth,
          mint,
          treasuryAta,
          protocolAuth.publicKey,
          1_000_000,
          [],
          undefined,
          TOKEN_PROGRAM_ID
        ),
      { label: "tier3d-mintTo", retries: 10, baseDelayMs: 120 }
    );

    recipient = Keypair.generate();
    await airdrop(provider, recipient.publicKey, 0.25);

    recipientAta = await getOrCreateAtaStable({
      conn: provider.connection,
      payer: protocolAuth,
      mint,
      owner: recipient.publicKey,
      allowOwnerOffCurve: false,
      label: "tier3d-recipient-ata",
    });

    await withRetry(
      () => setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false),
      { label: "tier3d-unpause-start", retries: 8, baseDelayMs: 100 }
    );
  });

  after(async () => {
    if (!program || !protocolAuth || !treasuryPda) return;

    await withRetry(
      () => setTreasuryPausedStrict(program, protocolAuth, treasuryPda, false),
      { label: "tier3d-unpause-end", retries: 8, baseDelayMs: 100 }
    );
  });

  it("Tier3D: concurrent PAY attempts against one pay_count fail safely", async () => {
    const treasuryStateBefore = await getTreasuryPayCount(program, treasuryPda);
    const [contestedReceipt] = derivePayReceiptPda(
      program.programId,
      treasuryPda,
      treasuryStateBefore
    );

    const beforeSnap = await snapshotTokenBalances({
      providerOrConn: provider,
      treasuryAta,
      userAtas: [recipientAta],
      mint,
      label: "tier3d-before",
    });

    const receiptAlreadyExists = await receiptExists(provider, contestedReceipt);
    expect(receiptAlreadyExists, "contested receipt already exists before test").to.eq(false);

    const contenders = Array.from({ length: CONTENDERS }, (_, i) => ({
      idx: i,
      who: `contender-${i + 1}`,
      recipient: recipient.publicKey,
      recipientAta,
    }));

    const results: PayAttemptResult[] = [];

    await runBoundedJittered({
      concurrency: CONTENDERS,
      items: contenders,
      minDelayMs: 0,
      maxDelayMs: 15,
      shuffle: true,
      worker: async (item) => {
        const res = await sendPayCollisionAttempt({
          provider,
          authority: protocolAuth,
          who: item.who,
          amount: PAY_AMOUNT,
          txFactory: async () =>
            buildSplPayTx({
              program,
              authority: protocolAuth,
              treasuryPda,
              mint,
              treasuryAta,
              recipient: item.recipient,
              recipientAta: item.recipientAta,
              amount: PAY_AMOUNT,
              receipt: contestedReceipt,
            }),
        });
        results.push(res);
      },
    });

    const afterSnap = await snapshotTokenBalances({
      providerOrConn: provider,
      treasuryAta,
      userAtas: [recipientAta],
      mint,
      label: "tier3d-after",
    });

    const treasuryStateAfter = await getTreasuryPayCount(program, treasuryPda);
    const receiptNowExists = await receiptExists(provider, contestedReceipt);

    const tDelta = treasuryDelta(beforeSnap, afterSnap);
    const uDelta = aggregateUserDelta(beforeSnap, afterSnap);

    const successes = results.filter((r) => r.kind === "SUCCESS");
    const failures = results.filter((r) => r.kind === "FAIL_EXPECTED");

    expect(successes.length, "more than one contested PAY succeeded").to.be.at.most(1);
    expect(failures.length, "expected at least one collision loser").to.be.greaterThan(0);

    if (successes.length === 1) {
      expect(receiptNowExists, "receipt missing after one successful contested PAY").to.eq(true);

      expect(
        treasuryStateAfter.toString(),
        "pay_count should increment exactly once after one contested success"
      ).to.eq((treasuryStateBefore + 1n).toString());

      expect(tDelta.toString(), "treasury delta mismatch under contested success").to.eq(
        BigInt(PAY_AMOUNT).toString()
      );
      expect(uDelta.toString(), "recipient aggregate delta mismatch under contested success").to.eq(
        BigInt(PAY_AMOUNT).toString()
      );
      expect(tDelta.toString(), "treasury/user delta mismatch").to.eq(uDelta.toString());
    } else {
      expect(receiptNowExists, "receipt should not exist if zero contested PAYs succeeded").to.eq(false);

      expect(
        treasuryStateAfter.toString(),
        "pay_count must remain unchanged if zero contested PAYs succeeded"
      ).to.eq(treasuryStateBefore.toString());

      assertTrackedInvariantUnchanged(
        beforeSnap,
        afterSnap,
        "tracked balances changed despite zero contested PAY successes"
      );
    }

    console.log("Tier3D Evidence:", {
      payCountBefore: treasuryStateBefore.toString(),
      payCountAfter: treasuryStateAfter.toString(),
      contestedReceipt: contestedReceipt.toBase58(),
      contenders: CONTENDERS,
      successes: successes.length,
      failures: failures.length,
      treasuryDelta: tDelta.toString(),
      recipientAggregateDelta: uDelta.toString(),
      receiptExistsAfter: receiptNowExists,
      treasuryBefore: beforeSnap.treasuryBalance.toString(),
      treasuryAfter: afterSnap.treasuryBalance.toString(),
      totalTrackedBefore: beforeSnap.totalTracked.toString(),
      totalTrackedAfter: afterSnap.totalTracked.toString(),
      results,
    });
  });
});
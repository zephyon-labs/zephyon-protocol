// tests/stress_tier3f_stale_receipt_reject.spec.ts
//
// Tier3F: Stale prebuilt receipt reject (STRICT)
//
// Purpose:
// - Prove a prebuilt splPay transaction using a stale pay_count-based receipt PDA
//   is rejected once pay_count has advanced.
//
// Core principle:
// With canonical pay_count receipt derivation, a transaction prebuilt against
// pay_count = N becomes invalid if another valid pay succeeds first and advances
// pay_count to N + 1.
//
// Hardening goals:
// 1) Prebuild a stale tx against pay_count N
// 2) Send a separately built valid tx against pay_count N
// 3) Explicitly prove valid tx success via:
//    - pay_count increment
//    - treasury decrease
//    - recipient increase
//    - valid receipt existence
// 4) Only then send stale tx
// 5) Assert stale tx fails with ConstraintSeeds and causes no further movement
//
// NOTE:
// - We preserve raw IDL-driven instruction building.
// - We DO NOT use local ad hoc ATA creation or direct getAccount reads.
// - All SPL infra now routes through strict helpers.

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
} from "@solana/spl-token";
import { expect } from "chai";

import {
  loadProtocolAuthority,
  airdrop,
  initFoundationOnce,
  derivePayReceiptPda,
  getTreasuryPayCount,
  receiptExists,
  withRetry,
  sendRawTxFresh,

  // strict SPL infra
  createMintStrict,
  createAtaStrict,
  mintToStrict,
  getTokenBalanceOrZero,
  getAccountInfoOrNull,
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

function isConstraintSeedsFailureMessage(message: string): boolean {
  const s = String(message).toLowerCase();
  return (
    s.includes("constraintseeds") ||
    s.includes("error number: 2006") ||
    s.includes("a seeds constraint was violated") ||
    s.includes("account: receipt") ||
    s.includes("custom program error: 0x7d6")
  );
}

async function fetchTreasuryState(
  program: Program<any>,
  treasuryPda: PublicKey
): Promise<any> {
  return await (program as any).account.treasury.fetch(treasuryPda);
}

async function waitForPauseState(
  program: Program<any>,
  treasuryPda: PublicKey,
  expectedPaused: boolean,
  label: string
): Promise<void> {
  await withRetry(
    async () => {
      const treasuryState: any = await fetchTreasuryState(program, treasuryPda);
      if (Boolean(treasuryState.paused) !== expectedPaused) {
        throw new Error(
          `${label}: pause state not yet ${expectedPaused ? "paused" : "unpaused"}`
        );
      }
    },
    {
      label,
      retries: 10,
      baseDelayMs: 80,
    }
  );
}

async function waitExecutionBarrier(
  provider: anchor.AnchorProvider,
  label: string
): Promise<void> {
  await withRetry(
    async () => {
      await provider.connection.getLatestBlockhash("finalized");
    },
    {
      label: `${label}-blockhash-barrier`,
      retries: 6,
      baseDelayMs: 60,
    }
  );

  await sleep(250);
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

  await sendRawTxFresh({
    provider: program.provider as anchor.AnchorProvider,
    tx,
    signers: [authority],
    commitment: "confirmed",
  });
}

async function setAndConfirmPaused(
  program: Program<any>,
  provider: anchor.AnchorProvider,
  authority: Keypair,
  treasuryPda: PublicKey,
  paused: boolean,
  label: string
): Promise<void> {
  await setTreasuryPausedStrict(program, authority, treasuryPda, paused);
  await waitForPauseState(
    program,
    treasuryPda,
    paused,
    `${label}-${paused ? "paused" : "unpaused"}`
  );
  await waitExecutionBarrier(provider, `${label}-execution-barrier`);
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
      throw new Error("Tier3F expects current payCount-mode splPay, not nonce-mode.");
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

async function assertTokenAccountReady(args: {
  provider: anchor.AnchorProvider;
  ata: PublicKey;
  expectedOwner?: PublicKey;
  label: string;
}) {
  const { provider, ata, expectedOwner, label } = args;

  await withRetry(
    async () => {
      const info = await getAccountInfoOrNull(provider, ata, "finalized");
      if (!info) {
        throw new Error(`${label}: token account not visible yet: ${ata.toBase58()}`);
      }
      if (!info.owner.equals(TOKEN_PROGRAM_ID)) {
        throw new Error(
          `${label}: token account owner mismatch. ata=${ata.toBase58()} actualOwner=${info.owner.toBase58()} expectedOwner=${TOKEN_PROGRAM_ID.toBase58()}`
        );
      }

      const bal = await getTokenBalanceOrZero(provider, ata);
      if (bal < 0n) {
        throw new Error(`${label}: impossible negative balance`);
      }

      if (expectedOwner) {
        // We do not decode the full token account here because createAtaStrict already
        // validated mint/owner pairing on creation. This readiness check is about
        // visibility + token-program ownership + readable balance.
        // The expectedOwner arg remains for structured callsites and future debugging.
        void expectedOwner;
      }
    },
    {
      label,
      retries: 12,
      baseDelayMs: 100,
    }
  );
}

async function readTokenBalanceStrict(
  provider: anchor.AnchorProvider,
  ata: PublicKey,
  label: string
): Promise<bigint> {
  return await withRetry(
    async () => {
      const info = await getAccountInfoOrNull(provider, ata, "finalized");
      if (!info) {
        throw new Error(`${label}: token account not visible yet: ${ata.toBase58()}`);
      }
      return await getTokenBalanceOrZero(provider, ata);
    },
    {
      label,
      retries: 12,
      baseDelayMs: 100,
    }
  );
}

async function waitForReceiptExists(
  provider: anchor.AnchorProvider,
  receipt: PublicKey,
  label: string
): Promise<void> {
  await withRetry(
    async () => {
      const exists = await receiptExists(provider, receipt, "finalized");
      if (!exists) {
        throw new Error(`${label}: receipt not visible yet: ${receipt.toBase58()}`);
      }
    },
    {
      label,
      retries: 12,
      baseDelayMs: 100,
    }
  );
}

describe("stress - Tier3F stale prebuilt receipt reject (STRICT)", function () {
  this.timeout(1_200_000);

  let provider: anchor.AnchorProvider;
  let program: Program<any>;
  let protocolAuth: Keypair;
  let treasuryPda: PublicKey;

  let mint: PublicKey;
  let treasuryAta: PublicKey;

  let recipientA: Keypair;
  let recipientB: Keypair;
  let recipientAtaA: PublicKey;
  let recipientAtaB: PublicKey;

  const PAY_AMOUNT = Number(process.env.TIER3F_PAY_AMOUNT ?? "111");

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
      throw new Error("Tier3F expects current payCount-mode splPay, not nonce-mode.");
    }

    const foundation = await initFoundationOnce(provider, program);
    treasuryPda = foundation.treasuryPda;

    mint = await createMintStrict({
      provider,
      payer: protocolAuth,
      mintAuthority: protocolAuth.publicKey,
      freezeAuthority: null,
      decimals: 6,
    });

    treasuryAta = await createAtaStrict({
      provider,
      payer: protocolAuth,
      mint,
      owner: treasuryPda,
      allowOwnerOffCurve: true,
    });

    await mintToStrict({
      provider,
      payer: protocolAuth,
      mint,
      destinationAta: treasuryAta,
      mintAuthoritySigner: protocolAuth,
      amount: 1_000_000n,
    });

    recipientA = Keypair.generate();
    recipientB = Keypair.generate();

    await airdrop(provider, recipientA.publicKey, 0.25);
    await airdrop(provider, recipientB.publicKey, 0.25);

    recipientAtaA = await createAtaStrict({
      provider,
      payer: protocolAuth,
      mint,
      owner: recipientA.publicKey,
      allowOwnerOffCurve: false,
    });

    recipientAtaB = await createAtaStrict({
      provider,
      payer: protocolAuth,
      mint,
      owner: recipientB.publicKey,
      allowOwnerOffCurve: false,
    });

    await assertTokenAccountReady({
      provider,
      ata: treasuryAta,
      expectedOwner: treasuryPda,
      label: "tier3f-treasuryAta-ready",
    });

    await assertTokenAccountReady({
      provider,
      ata: recipientAtaA,
      expectedOwner: recipientA.publicKey,
      label: "tier3f-recipientAtaA-ready",
    });

    await assertTokenAccountReady({
      provider,
      ata: recipientAtaB,
      expectedOwner: recipientB.publicKey,
      label: "tier3f-recipientAtaB-ready",
    });

    await withRetry(
      async () => {
        const bal = await readTokenBalanceStrict(
          provider,
          treasuryAta,
          "tier3f-treasuryAta-funded"
        );
        if (bal < 1_000_000n) {
          throw new Error(
            `tier3f treasury ATA not funded yet. got=${bal.toString()} expected>=1000000`
          );
        }
      },
      { label: "tier3f-treasuryAta-funded-wrapper", retries: 10, baseDelayMs: 100 }
    );

    await withRetry(
      async () => {
        await setAndConfirmPaused(
          program,
          provider,
          protocolAuth,
          treasuryPda,
          false,
          "tier3f-unpause-start"
        );
      },
      { label: "tier3f-unpause-start-wrapper", retries: 8, baseDelayMs: 100 }
    );

    console.log("Tier3F setup:", {
      programId: program.programId.toBase58(),
      treasuryPda: treasuryPda.toBase58(),
      mint: mint.toBase58(),
      treasuryAta: treasuryAta.toBase58(),
      recipientA: recipientA.publicKey.toBase58(),
      recipientAtaA: recipientAtaA.toBase58(),
      recipientB: recipientB.publicKey.toBase58(),
      recipientAtaB: recipientAtaB.toBase58(),
    });
  });

  after(async () => {
    if (!program || !protocolAuth || !treasuryPda) return;

    await withRetry(
      async () => {
        await setAndConfirmPaused(
          program,
          provider,
          protocolAuth,
          treasuryPda,
          false,
          "tier3f-unpause-end"
        );
      },
      { label: "tier3f-unpause-end-wrapper", retries: 8, baseDelayMs: 100 }
    );
  });

  it("rejects stale prebuilt receipt after pay_count advances", async () => {
    const treasuryBeforeAmt = await readTokenBalanceStrict(
      provider,
      treasuryAta,
      "tier3f-treasuryBefore"
    );

    const recipientABeforeAmt = await readTokenBalanceStrict(
      provider,
      recipientAtaA,
      "tier3f-recipientABefore"
    );

    const recipientBBeforeAmt = await readTokenBalanceStrict(
      provider,
      recipientAtaB,
      "tier3f-recipientBBefore"
    );

    const payCountBefore = await getTreasuryPayCount(program, treasuryPda);

    // Prebuild stale tx against current pay_count N
    const [staleReceipt] = derivePayReceiptPda(
      program.programId,
      treasuryPda,
      payCountBefore
    );

    const staleTx = await buildSplPayTx({
      program,
      authority: protocolAuth,
      treasuryPda,
      mint,
      treasuryAta,
      recipient: recipientA.publicKey,
      recipientAta: recipientAtaA,
      amount: PAY_AMOUNT,
      receipt: staleReceipt,
    });

    // Build and send valid intervening tx against same pay_count N
    const [validReceipt] = derivePayReceiptPda(
      program.programId,
      treasuryPda,
      payCountBefore
    );

    const validTx = await buildSplPayTx({
      program,
      authority: protocolAuth,
      treasuryPda,
      mint,
      treasuryAta,
      recipient: recipientB.publicKey,
      recipientAta: recipientAtaB,
      amount: PAY_AMOUNT,
      receipt: validReceipt,
    });

    await sendRawTxFresh({
  provider,
  tx: validTx,
  signers: [protocolAuth],
  commitment: "finalized",
});

// Prove the valid intervening tx was actually valid.
// Receipt existence is checked LAST because it can surface later than the
// balance/state movement even after a successful confirmed send.

const payCountAfterValid = await withRetry(
  async () => {
    const next = await getTreasuryPayCount(program, treasuryPda);
    if (next !== payCountBefore + 1n) {
      throw new Error(
        `pay_count not advanced yet. got=${next.toString()} expected=${(payCountBefore + 1n).toString()}`
      );
    }
    return next;
  },
  {
    label: "tier3f-payCountAfterValid",
    retries: 20,
    baseDelayMs: 150,
  }
);

const treasuryAfterValidAmt = await withRetry(
  async () => {
    const amt = await readTokenBalanceStrict(
      provider,
      treasuryAta,
      "tier3f-treasuryAfterValid"
    );
    if (treasuryBeforeAmt - amt !== BigInt(PAY_AMOUNT)) {
      throw new Error(
        `treasury delta not visible yet. got=${(treasuryBeforeAmt - amt).toString()} expected=${BigInt(PAY_AMOUNT).toString()}`
      );
    }
    return amt;
  },
  {
    label: "tier3f-treasuryAfterValid-wrapper",
    retries: 20,
    baseDelayMs: 150,
  }
);

const recipientAAfterValidAmt = await withRetry(
  async () => {
    const amt = await readTokenBalanceStrict(
      provider,
      recipientAtaA,
      "tier3f-recipientAAfterValid"
    );
    if (amt - recipientABeforeAmt !== 0n) {
      throw new Error(
        `recipient A changed unexpectedly. delta=${(amt - recipientABeforeAmt).toString()}`
      );
    }
    return amt;
  },
  {
    label: "tier3f-recipientAAfterValid-wrapper",
    retries: 20,
    baseDelayMs: 150,
  }
);

const recipientBAfterValidAmt = await withRetry(
  async () => {
    const amt = await readTokenBalanceStrict(
      provider,
      recipientAtaB,
      "tier3f-recipientBAfterValid"
    );
    if (amt - recipientBBeforeAmt !== BigInt(PAY_AMOUNT)) {
      throw new Error(
        `recipient B delta not visible yet. got=${(amt - recipientBBeforeAmt).toString()} expected=${BigInt(PAY_AMOUNT).toString()}`
      );
    }
    return amt;
  },
  {
    label: "tier3f-recipientBAfterValid-wrapper",
    retries: 20,
    baseDelayMs: 150,
  }
);

await waitForReceiptExists(provider, validReceipt, "tier3f-validReceipt-exists");

    expect(
      (treasuryBeforeAmt - treasuryAfterValidAmt).toString(),
      "valid intervening pay should decrease treasury by PAY_AMOUNT"
    ).to.eq(BigInt(PAY_AMOUNT).toString());

    expect(
      (recipientAAfterValidAmt - recipientABeforeAmt).toString(),
      "stale recipient should still be unchanged after valid intervening pay"
    ).to.eq("0");

    expect(
      (recipientBAfterValidAmt - recipientBBeforeAmt).toString(),
      "valid recipient should increase by PAY_AMOUNT"
    ).to.eq(BigInt(PAY_AMOUNT).toString());

    // Send stale tx now that pay_count is N+1
    let staleErrorMessage = "";
    try {
      await sendRawTxFresh({
        provider,
        tx: staleTx,
        signers: [protocolAuth],
        commitment: "confirmed",
      });
      throw new Error("stale prebuilt tx unexpectedly succeeded");
    } catch (e: any) {
      staleErrorMessage = String(e?.message ?? e);
    }

    expect(
      isConstraintSeedsFailureMessage(staleErrorMessage),
      `expected stale tx to fail with receipt ConstraintSeeds, got: ${staleErrorMessage}`
    ).to.eq(true);

    const payCountAfterStale = await getTreasuryPayCount(program, treasuryPda);
    expect(
      payCountAfterStale.toString(),
      "stale tx must not increment pay_count"
    ).to.eq(payCountAfterValid.toString());

    expect(
  staleReceipt.toBase58(),
  "stale and valid receipt PDAs should be identical in this test design"
).to.eq(validReceipt.toBase58());

const staleReceiptExists = await receiptExists(provider, staleReceipt, "finalized");
expect(
  staleReceiptExists,
  "receipt PDA for pay_count N should still exist because the valid intervening pay created it"
).to.eq(true);

    const treasuryAfterStaleAmt = await readTokenBalanceStrict(
      provider,
      treasuryAta,
      "tier3f-treasuryAfterStale"
    );

    const recipientAAfterStaleAmt = await readTokenBalanceStrict(
      provider,
      recipientAtaA,
      "tier3f-recipientAAfterStale"
    );

    const recipientBAfterStaleAmt = await readTokenBalanceStrict(
      provider,
      recipientAtaB,
      "tier3f-recipientBAfterStale"
    );

    expect(
      (treasuryBeforeAmt - treasuryAfterStaleAmt).toString(),
      "treasury delta should reflect only the valid intervening pay"
    ).to.eq(BigInt(PAY_AMOUNT).toString());

    expect(
      (recipientAAfterStaleAmt - recipientABeforeAmt).toString(),
      "stale recipient should not receive funds"
    ).to.eq("0");

    expect(
      (recipientBAfterStaleAmt - recipientBBeforeAmt).toString(),
      "valid recipient should remain up by PAY_AMOUNT"
    ).to.eq(BigInt(PAY_AMOUNT).toString());

    console.log("Tier3F Evidence:", {
      payCountBefore: payCountBefore.toString(),
      payCountAfterValid: payCountAfterValid.toString(),
      payCountAfterStale: payCountAfterStale.toString(),
      treasuryBefore: treasuryBeforeAmt.toString(),
      treasuryAfterValid: treasuryAfterValidAmt.toString(),
      treasuryAfterStale: treasuryAfterStaleAmt.toString(),
      recipientABefore: recipientABeforeAmt.toString(),
      recipientAAfterValid: recipientAAfterValidAmt.toString(),
      recipientAAfterStale: recipientAAfterStaleAmt.toString(),
      recipientBBefore: recipientBBeforeAmt.toString(),
      recipientBAfterValid: recipientBAfterValidAmt.toString(),
      recipientBAfterStale: recipientBAfterStaleAmt.toString(),
      staleReceipt: staleReceipt.toBase58(),
      validReceipt: validReceipt.toBase58(),
      staleErrorMessage,
    });
  });
});
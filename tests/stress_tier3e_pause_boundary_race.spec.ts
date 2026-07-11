// tests/stress_tier3e_pause_boundary_race.spec.ts
//
// Tier3E: Pause boundary semantics using splDeposit (STRICT)
//
// Purpose:
// - Prove a pause-gated instruction obeys treasury pause state at execution time
// - Isolate pause semantics from pay_count/receipt PDA drift
//
// Why splDeposit:
// - splPay is coupled to canonical pay_count receipt derivation.
// - splDeposit is pause-gated but does not rely on the same receipt PDA path,
//   making it a cleaner witness for pause-boundary semantics.
//
// Rewrite strategy:
// - preserve raw IDL-driven instruction construction
// - preserve explicit pause toggle confirmation
// - preserve execution barrier after pause transitions
// - prove balance movement (or lack of movement) per attempt
// - fail immediately when a claimed SUCCESS does not actually move value
//
// This revision strengthens pause-boundary determinism by:
// 1) waiting for setTreasuryPaused tx at FINALIZED
// 2) fetching treasury pause state at FINALIZED
// 3) extending execution barrier sleep to 500ms

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
} from "@solana/spl-token";
import { expect } from "chai";

import {
  loadProtocolAuthority,
  airdrop,
  initFoundationOnce,
  setupMintAndAtasStrict,
  withRetry,
  sendRawTxFresh,
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

function isPauseLikeFailureMessage(message: string): boolean {
  const s = String(message).toLowerCase();
  return (
    s.includes("protocolpaused") ||
    s.includes("treasurypaused") ||
    s.includes("treasury paused") ||
    s.includes("protocol paused") ||
    s.includes('"custom":6000') ||
    s.includes('"custom": 6000') ||
    s.includes("custom:6000") ||
    s.includes("custom: 6000")
  );
}

async function fetchTreasuryState(
  program: Program<any>,
  treasuryPda: PublicKey
): Promise<any> {
  return await (program.account as any).treasury.fetch(treasuryPda, "finalized");
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
      retries: 12,
      baseDelayMs: 100,
    }
  );
}

async function waitExecutionBarrier(
  provider: AnchorProvider,
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

  await sleep(500);
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

async function setAndConfirmPaused(
  program: Program<any>,
  provider: AnchorProvider,
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
    const n = String(a.name).toLowerCase();
    if (n === "amount") argsObj[a.name] = bn(amount);
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

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys,
    data,
  });

  return new Transaction().add(ix);
}

type DepositOutcome =
  | { kind: "SUCCESS"; label: string; amount: number }
  | { kind: "REJECT_PAUSED"; label: string; amount: number; message: string }
  | { kind: "REJECT_OTHER"; label: string; amount: number; message: string };

async function sendBoundaryDeposit(args: {
  provider: AnchorProvider;
  authority: Keypair;
  tx: Transaction;
  label: string;
  amount: number;
}): Promise<DepositOutcome> {
  const { provider, authority, tx, label, amount } = args;

  try {
    await sendRawTxFresh({
      provider,
      tx,
      signers: [authority],
      commitment: "finalized",
    });

    return { kind: "SUCCESS", label, amount };
  } catch (e: any) {
    const message = String(e?.message ?? e);

    if (isPauseLikeFailureMessage(message)) {
      return { kind: "REJECT_PAUSED", label, amount, message };
    }

    return { kind: "REJECT_OTHER", label, amount, message };
  }
}

async function assertTokenAccountReady(
  provider: AnchorProvider,
  ata: PublicKey,
  label: string
): Promise<void> {
  await withRetry(
    async () => {
      const info = await getAccountInfoOrNull(provider, ata, "finalized");
      if (!info) {
        throw new Error(`${label}: token account not visible yet: ${ata.toBase58()}`);
      }
      if (!info.owner.equals(TOKEN_PROGRAM_ID)) {
        throw new Error(
          `${label}: owner mismatch. ata=${ata.toBase58()} actual=${info.owner.toBase58()} expected=${TOKEN_PROGRAM_ID.toBase58()}`
        );
      }
      await getTokenBalanceOrZero(provider, ata);
    },
    {
      label,
      retries: 12,
      baseDelayMs: 100,
    }
  );
}

async function readTokenBalanceStrict(
  provider: AnchorProvider,
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

async function expectNoMovement(args: {
  provider: AnchorProvider;
  treasuryAta: PublicKey;
  userAta: PublicKey;
  treasuryBefore: bigint;
  userBefore: bigint;
  label: string;
}) {
  const { provider, treasuryAta, userAta, treasuryBefore, userBefore, label } = args;

  const treasuryAfter = await withRetry(
    async () => {
      const amt = await readTokenBalanceStrict(
        provider,
        treasuryAta,
        `${label}-treasury-no-move`
      );
      if (amt !== treasuryBefore) {
        throw new Error(
          `${label}: treasury moved unexpectedly. before=${treasuryBefore.toString()} after=${amt.toString()}`
        );
      }
      return amt;
    },
    {
      label: `${label}-treasury-no-move-wrapper`,
      retries: 10,
      baseDelayMs: 100,
    }
  );

  const userAfter = await withRetry(
    async () => {
      const amt = await readTokenBalanceStrict(
        provider,
        userAta,
        `${label}-user-no-move`
      );
      if (amt !== userBefore) {
        throw new Error(
          `${label}: user moved unexpectedly. before=${userBefore.toString()} after=${amt.toString()}`
        );
      }
      return amt;
    },
    {
      label: `${label}-user-no-move-wrapper`,
      retries: 10,
      baseDelayMs: 100,
    }
  );

  return { treasuryAfter, userAfter };
}

async function expectExactMovement(args: {
  provider: AnchorProvider;
  treasuryAta: PublicKey;
  userAta: PublicKey;
  treasuryBefore: bigint;
  userBefore: bigint;
  amount: bigint;
  label: string;
}) {
  const {
    provider,
    treasuryAta,
    userAta,
    treasuryBefore,
    userBefore,
    amount,
    label,
  } = args;

  const treasuryAfter = await withRetry(
    async () => {
      const amt = await readTokenBalanceStrict(
        provider,
        treasuryAta,
        `${label}-treasury-move`
      );
      const delta = amt - treasuryBefore;
      if (delta !== amount) {
        throw new Error(
          `${label}: treasury delta mismatch. got=${delta.toString()} expected=${amount.toString()}`
        );
      }
      return amt;
    },
    {
      label: `${label}-treasury-move-wrapper`,
      retries: 20,
      baseDelayMs: 150,
    }
  );

  const userAfter = await withRetry(
    async () => {
      const amt = await readTokenBalanceStrict(
        provider,
        userAta,
        `${label}-user-move`
      );
      const delta = userBefore - amt;
      if (delta !== amount) {
        throw new Error(
          `${label}: user delta mismatch. got=${delta.toString()} expected=${amount.toString()}`
        );
      }
      return amt;
    },
    {
      label: `${label}-user-move-wrapper`,
      retries: 20,
      baseDelayMs: 150,
    }
  );

  return { treasuryAfter, userAfter };
}

describe("stress - Tier3E pause boundary semantics via splDeposit (STRICT)", function () {
  this.timeout(1_200_000);

  let provider: AnchorProvider;
  let program: Program<any>;
  let protocolAuth: Keypair;
  let treasuryPda: PublicKey;

  let mint: PublicKey;
  let userAta: PublicKey;
  let treasuryAta: PublicKey;

  const ATTEMPTS = Number(process.env.TIER3E_ATTEMPTS ?? "8");
  const DEPOSIT_AMOUNT = Number(process.env.TIER3E_DEPOSIT_AMOUNT ?? "111");

  before(async () => {
    const envProvider = anchor.AnchorProvider.env();
    protocolAuth = loadProtocolAuthority();

    await airdrop(envProvider, protocolAuth.publicKey, 2);
    await sleep(150);

    provider = new AnchorProvider(
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

    const foundation = await initFoundationOnce(provider, program);
    treasuryPda = foundation.treasuryPda;

    const setup = await setupMintAndAtasStrict({
      provider,
      payer: protocolAuth,
      treasuryOwner: treasuryPda,
      initialUserAmount: 1_000_000n,
      decimals: 6,
    });

    mint = setup.mint;
    userAta = setup.userAta;
    treasuryAta = setup.treasuryAta;

    await assertTokenAccountReady(provider, userAta, "tier3e-userAta-ready");
    await assertTokenAccountReady(provider, treasuryAta, "tier3e-treasuryAta-ready");

    await withRetry(
      async () => {
        const userBal = await readTokenBalanceStrict(
          provider,
          userAta,
          "tier3e-userAta-funded"
        );
        if (userBal < 1_000_000n) {
          throw new Error(
            `tier3e user ATA not funded yet. got=${userBal.toString()} expected>=1000000`
          );
        }
      },
      {
        label: "tier3e-userAta-funded-wrapper",
        retries: 10,
        baseDelayMs: 100,
      }
    );

    await withRetry(
      async () => {
        await setAndConfirmPaused(
          program,
          provider,
          protocolAuth,
          treasuryPda,
          false,
          "tier3e-unpause-start"
        );
      },
      { label: "tier3e-unpause-start-wrapper", retries: 8, baseDelayMs: 100 }
    );

    console.log("Tier3E setup:", {
      programId: program.programId.toBase58(),
      treasuryPda: treasuryPda.toBase58(),
      mint: mint.toBase58(),
      userAta: userAta.toBase58(),
      treasuryAta: treasuryAta.toBase58(),
      attempts: ATTEMPTS,
      depositAmount: DEPOSIT_AMOUNT,
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
          "tier3e-unpause-end"
        );
      },
      { label: "tier3e-unpause-end-wrapper", retries: 8, baseDelayMs: 100 }
    );
  });

  it("splDeposit obeys current runtime pause state", async () => {
    const attempts = Array.from({ length: ATTEMPTS }, (_, i) => ({
      label: `boundary-${i + 1}`,
      shouldReject: i % 2 === 0,
    }));

    const results: DepositOutcome[] = [];
    let successfulDeposits = 0;

    let runningTreasury = await readTokenBalanceStrict(
      provider,
      treasuryAta,
      "tier3e-runningTreasury-start"
    );

    let runningUser = await readTokenBalanceStrict(
      provider,
      userAta,
      "tier3e-runningUser-start"
    );

    const suiteTreasuryStart = runningTreasury;
    const suiteUserStart = runningUser;

    for (const attempt of attempts) {
      if (attempt.shouldReject) {
        await setAndConfirmPaused(
          program,
          provider,
          protocolAuth,
          treasuryPda,
          true,
          `${attempt.label}-paused-before-send`
        );

        const tx = await buildSplDepositTx({
          program,
          authority: protocolAuth,
          treasuryPda,
          mint,
          userAta,
          treasuryAta,
          amount: DEPOSIT_AMOUNT,
        });

        const out = await sendBoundaryDeposit({
          provider,
          authority: protocolAuth,
          tx,
          label: attempt.label,
          amount: DEPOSIT_AMOUNT,
        });

        results.push(out);

        expect(
          out.kind,
          `${attempt.label}: deposit while paused must reject. Actual message: ${
            "message" in out ? out.message : ""
          }`
        ).to.eq("REJECT_PAUSED");

        const noMove = await expectNoMovement({
          provider,
          treasuryAta,
          userAta,
          treasuryBefore: runningTreasury,
          userBefore: runningUser,
          label: `${attempt.label}-paused-proof`,
        });

        runningTreasury = noMove.treasuryAfter;
        runningUser = noMove.userAfter;
      } else {
        await setAndConfirmPaused(
          program,
          provider,
          protocolAuth,
          treasuryPda,
          false,
          `${attempt.label}-unpaused-before-send`
        );

        const tx = await buildSplDepositTx({
          program,
          authority: protocolAuth,
          treasuryPda,
          mint,
          userAta,
          treasuryAta,
          amount: DEPOSIT_AMOUNT,
        });

        const out = await sendBoundaryDeposit({
          provider,
          authority: protocolAuth,
          tx,
          label: attempt.label,
          amount: DEPOSIT_AMOUNT,
        });

        results.push(out);

        expect(
          out.kind,
          `${attempt.label}: deposit while unpaused must succeed. Actual message: ${
            "message" in out ? out.message : ""
          }`
        ).to.eq("SUCCESS");

        const moved = await expectExactMovement({
          provider,
          treasuryAta,
          userAta,
          treasuryBefore: runningTreasury,
          userBefore: runningUser,
          amount: BigInt(DEPOSIT_AMOUNT),
          label: `${attempt.label}-unpaused-proof`,
        });

        runningTreasury = moved.treasuryAfter;
        runningUser = moved.userAfter;
        successfulDeposits += 1;
      }
    }

    const successCount = results.filter((r) => r.kind === "SUCCESS").length;
    const rejectPausedCount = results.filter((r) => r.kind === "REJECT_PAUSED").length;
    const rejectOther = results.filter((r) => r.kind === "REJECT_OTHER");

    const expectedSuccess = Math.floor(ATTEMPTS / 2);
    const expectedRejectPaused = ATTEMPTS - expectedSuccess;
    const expectedDelta = BigInt(successfulDeposits * DEPOSIT_AMOUNT);

    expect(
      rejectOther.length,
      `unexpected non-pause rejections detected: ${JSON.stringify(rejectOther, null, 2)}`
    ).to.eq(0);

    expect(successCount).to.eq(successfulDeposits);
    expect(successCount).to.eq(expectedSuccess);
    expect(rejectPausedCount).to.eq(expectedRejectPaused);

    const suiteTreasuryEnd = await readTokenBalanceStrict(
      provider,
      treasuryAta,
      "tier3e-suiteTreasuryEnd"
    );
    const suiteUserEnd = await readTokenBalanceStrict(
      provider,
      userAta,
      "tier3e-suiteUserEnd"
    );

    const treasuryDelta = suiteTreasuryEnd - suiteTreasuryStart;
    const userDelta = suiteUserStart - suiteUserEnd;

    expect(
      treasuryDelta.toString(),
      "suite treasury delta must reflect only successful unpaused deposits"
    ).to.eq(expectedDelta.toString());

    expect(
      userDelta.toString(),
      "suite user delta must reflect only successful unpaused deposits"
    ).to.eq(expectedDelta.toString());

    console.log("Tier3E Evidence:", {
      attempts: ATTEMPTS,
      successCount,
      rejectPausedCount,
      successfulDeposits,
      suiteTreasuryStart: suiteTreasuryStart.toString(),
      suiteTreasuryEnd: suiteTreasuryEnd.toString(),
      treasuryDelta: treasuryDelta.toString(),
      suiteUserStart: suiteUserStart.toString(),
      suiteUserEnd: suiteUserEnd.toString(),
      userDelta: userDelta.toString(),
      expectedDelta: expectedDelta.toString(),
      results,
    });
  });
});

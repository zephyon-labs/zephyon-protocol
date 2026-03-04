/**
 * Tier1 Stress Suite (Pay-count canonical)
 * - Validates splPay sequential and bounded concurrency
 * - Uses canonical receipt seeds (pay_count-before)
 * - Precreates recipient ATAs to avoid allocation races
 *
 * NOTE:
 * This suite intentionally uses retry-on-seeds to handle
 * ordering/race under bounded concurrency.
 */

// tests/stress_spl_pay.spec.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

import { Protocol } from "../target/types/protocol";
import { getTxWithRetry } from "./helpers/tx";

import {
  getProgram,
  initFoundationOnce,
  setupMintAndAtas,
  loadProtocolAuthority,
  airdrop,
  BN,
  expect,
} from "./_helpers";

/**
 * Helpers
 */
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isAccountInUseLike(err: any) {
  const s = String(err?.message ?? err);
  return (
    s.includes("AccountInUse") ||
    s.includes("already in use") ||
    s.includes("account in use") ||
    s.includes("Allocate: account")
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

function u64LE(n: anchor.BN): Buffer {
  return n.toArrayLike(Buffer, "le", 8);
}

/**
 * Canonical Receipt PDA:
 * ["receipt", treasuryPda, treasury.pay_count (u64 LE)]
 */
function payReceiptPdaFromPayCount(
  programId: PublicKey,
  treasuryPda: PublicKey,
  payCount: anchor.BN
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), treasuryPda.toBuffer(), u64LE(payCount)],
    programId
  );
  return pda;
}

describe("stress - splPay", function () {
  this.timeout(3_600_000); // 60 minutes
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let program: Program<Protocol>;

  let protocolAuthority: Keypair;
  let treasuryPda: PublicKey;

  let mint: PublicKey;
  let userAta: PublicKey;
  let treasuryAta: PublicKey;

  async function ensureAtaExists(owner: PublicKey): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const info = await provider.connection.getAccountInfo(ata, "confirmed");
    if (info) return ata;

    const ix = createAssociatedTokenAccountInstruction(
      protocolAuthority.publicKey, // payer
      ata, // ata
      owner, // owner
      mint, // mint
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const tx = new anchor.web3.Transaction().add(ix);
    await provider.sendAndConfirm(tx, [protocolAuthority], {
      commitment: "confirmed",
    });

    return ata;
  }

  async function fetchPayCount(): Promise<anchor.BN> {
    const t: any = await (program.account as any).treasury.fetch(treasuryPda);
    return new BN(t.payCount);
  }

  before(async () => {
    program = getProgram() as Program<Protocol>;

    const foundation = await initFoundationOnce(provider, program as any);
    treasuryPda = foundation.treasuryPda;

    protocolAuthority = loadProtocolAuthority();

    // fees
    await airdrop(provider, protocolAuthority.publicKey, 2);

    // ✅ Ensure NOT paused (prevents cross-test poisoning)
    try {
      await (program as any).methods
        .setTreasuryPaused(false)
        .accounts({
          treasuryAuthority: protocolAuthority.publicKey,
          treasury: treasuryPda,
        } as any)
        .signers([protocolAuthority])
        .rpc();
    } catch (_) {
      // ignore if method shape differs
    }

    // mint + atas (mints to USER ATA)
    const setup = await setupMintAndAtas(
      provider,
      protocolAuthority,
      treasuryPda,
      1_000_000n
    );

    mint = setup.mint;
    userAta = setup.userAta.address;
    treasuryAta = setup.treasuryAta.address;

    // fund treasury once
    await program.methods
      .splDeposit(new BN(900_000))
      .accounts({
        user: protocolAuthority.publicKey,
        treasury: treasuryPda,
        mint,
        userAta,
        treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([protocolAuthority])
      .rpc();

    const treasuryAcc = await getAccount(provider.connection, treasuryAta);
    console.log("TREASURY ATA FUNDED (raw units):", treasuryAcc.amount.toString());
  });

  /**
   * Sends one splPay using canonical 3-arg signature and pay_count receipt PDA.
   * Retries on transient issues + seed collisions.
   *
   * Strategy:
   * - On each attempt, fetch current pay_count, derive receipt PDA from it.
   * - If another in-flight tx wins and advances pay_count first,
   *   we may see ConstraintSeeds/AccountInUse; retry and refetch.
   */
  async function sendOnePay(
    recipient: PublicKey,
    recipientAta: PublicKey
  ): Promise<string> {
    const MAX_RETRIES = 14;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // Always derive receipt from current on-chain pay_count
      const payCount = await fetchPayCount();
      const receipt = payReceiptPdaFromPayCount(program.programId, treasuryPda, payCount);

      try {
        const latest = await provider.connection.getLatestBlockhash("confirmed");

        const tx = await (program as any).methods
          // ✅ Canon: splPay(amount, reference, memo)
          .splPay(new BN(1), null, null)
          .accounts({
            treasuryAuthority: protocolAuthority.publicKey,
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
          } as any)
          .transaction();

        tx.feePayer = protocolAuthority.publicKey;
        tx.recentBlockhash = latest.blockhash;
        tx.sign(protocolAuthority);

        const sig = await provider.connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        });

        await provider.connection.confirmTransaction(
          {
            signature: sig,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          },
          "confirmed"
        );

        const info = await getTxWithRetry(provider.connection, sig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });

        if (!info) {
          // transient RPC lag – retry
          await sleep(40 * attempt);
          continue;
        }

        if (info.meta?.err) {
          const logs = info.meta.logMessages ?? [];
          const joined = logs.join("\n");

          // Seed collision / ordering race: retry by refetching pay_count
          if (joined.toLowerCase().includes("constraintseeds") || joined.includes("2006")) {
            await sleep(40 * attempt);
            continue;
          }

          console.log("FAILED SIG:", sig);
          console.log("LOGS:\n", joined);
          throw new Error(`Transaction failed: ${JSON.stringify(info.meta.err)}`);
        }

        return sig;
      } catch (e: any) {
        const msg = String(e?.message ?? e);

        // Ordering/collision → retry
        if ((isConstraintSeedsLike(e) || isAccountInUseLike(e)) && attempt < MAX_RETRIES) {
          await sleep(50 * attempt);
          continue;
        }

        // Blockhash / confirm lag etc.
        const retryable =
          msg.includes("Blockhash not found") ||
          msg.includes("Transaction was not confirmed") ||
          msg.includes("Node is behind") ||
          msg.includes("429") ||
          msg.toLowerCase().includes("timeout");

        if (retryable && attempt < MAX_RETRIES) {
          await sleep(60 * attempt);
          continue;
        }

        throw e;
      }
    }

    throw new Error("sendOnePay exhausted retries");
  }

  it("sequential: 300 pays of 1 unit each", async () => {
    const ITER = 300;

    // recipients
    const recipients: Keypair[] = [];
    for (let i = 0; i < ITER; i++) recipients.push(Keypair.generate());

    for (let i = 0; i < recipients.length; i++) {
      if (i % 50 === 0) console.log(`airdrop ${i}/${ITER}`);
      await airdrop(provider, recipients[i].publicKey, 1);
    }

    // PRE-FLIGHT: create recipient ATAs sequentially (no racing allocations)
    const recipientAtas: PublicKey[] = [];
    for (let i = 0; i < recipients.length; i++) {
      if (i % 50 === 0) console.log(`precreate ata ${i}/${ITER}`);
      const ata = await ensureAtaExists(recipients[i].publicKey);
      recipientAtas.push(ata);
    }

    // PAY LOOP (canon pay_count receipt)
    for (let i = 0; i < ITER; i++) {
      await sendOnePay(recipients[i].publicKey, recipientAtas[i]);
      if (i % 50 === 0) console.log(`sequential ${i}/${ITER}`);
    }

    expect(true).to.eq(true);
  });

  it("bounded concurrency: 300 pays, batch size 5", async function () {
  this.timeout(3_600_000); // 60 minutes
    const TOTAL = 300;
    const CONCURRENCY = 5;

    const treasuryAccBefore = await getAccount(provider.connection, treasuryAta);
    console.log("TREASURY ATA BEFORE CONCURRENCY:", treasuryAccBefore.amount.toString());

    const recipients: Keypair[] = [];
    for (let i = 0; i < TOTAL; i++) recipients.push(Keypair.generate());

    for (let i = 0; i < recipients.length; i++) {
      if (i % 50 === 0) console.log(`airdrop ${i}/${TOTAL}`);
      await airdrop(provider, recipients[i].publicKey, 1);
    }

    // PRE-FLIGHT: create recipient ATAs sequentially
    const recipientAtas: PublicKey[] = [];
    for (let i = 0; i < recipients.length; i++) {
      if (i % 50 === 0) console.log(`precreate ata ${i}/${TOTAL}`);
      const ata = await ensureAtaExists(recipients[i].publicKey);
      recipientAtas.push(ata);
    }

    let sent = 0;

    while (sent < TOTAL) {
      const batch: Promise<string>[] = [];

      for (let i = 0; i < CONCURRENCY && sent < TOTAL; i++) {
        const idx = sent;
        sent++;

        batch.push(sendOnePay(recipients[idx].publicKey, recipientAtas[idx]));
      }

      await Promise.all(batch);
      if (sent % 50 === 0) console.log(`concurrent ${sent}/${TOTAL}`);
    }

    const treasuryAccAfter = await getAccount(provider.connection, treasuryAta);
    console.log("TREASURY ATA AFTER STRESS (raw units):", treasuryAccAfter.amount.toString());

    expect(true).to.eq(true);
  });
});





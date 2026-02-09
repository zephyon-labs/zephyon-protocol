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
  return s.includes("AccountInUse") || s.includes("already in use") || s.includes("account in use");
}

function u64LE(n: anchor.BN): Buffer {
  return n.toArrayLike(Buffer, "le", 8);
}

// Receipt PDA: ["receipt", treasuryPda, nonce(u64LE)]
function payReceiptPda(programId: PublicKey, treasuryPda: PublicKey, nonce: anchor.BN): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), treasuryPda.toBuffer(), u64LE(nonce)],
    programId
  );
  return pda;
}

describe("stress - splPay", function () {
  this.timeout(1_000_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let program: Program<Protocol>;

  let protocolAuthority: Keypair;
  let treasuryPda: PublicKey;

  let mint: PublicKey;
  let userAta: PublicKey;
  let treasuryAta: PublicKey;

  // IMPORTANT:
  // Core17/Core21 tests already consume small nonce values via nextNonce() starting at 1.
  // Stress must use a completely disjoint nonce range to avoid "receipt already in use".
  const BASE_NONCE = 1_000_000;

  async function ensureAtaExists(owner: PublicKey): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const info = await provider.connection.getAccountInfo(ata);
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
    await provider.sendAndConfirm(tx, [protocolAuthority], { commitment: "confirmed" });

    return ata;
  }

  before(async () => {
    program = getProgram() as Program<Protocol>;

    const foundation = await initFoundationOnce(provider, program as any);
    treasuryPda = foundation.treasuryPda;

    protocolAuthority = loadProtocolAuthority();

    // fees
    await airdrop(provider, protocolAuthority.publicKey, 2);

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
   * Sends one splPay tx using raw send + explicit confirm.
   * Includes a small retry on "AccountInUse-like" errors.
   *
   * IMPORTANT: recipient ATA must already exist (preflight does this).
   */
  async function sendOnePay(
    recipient: PublicKey,
    recipientAta: PublicKey,
    clientNonce: number
  ): Promise<string> {
    const MAX_RETRIES = 6;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const nonceBn = new BN(clientNonce);
        const receipt = payReceiptPda(program.programId, treasuryPda, nonceBn);

        const latest = await provider.connection.getLatestBlockhash("confirmed");

        const tx = await program.methods
          .splPay(new BN(1), null, null, nonceBn)
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

        const txInfo = await getTxWithRetry(provider.connection, sig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });

        if (!txInfo) {
          throw new Error(`getTransaction still null after retry loop for ${sig}`);
        }

        if (txInfo.meta?.err) {
          console.log("FAILED SIG:", sig);
          console.log("LOGS:\n", (txInfo.meta.logMessages ?? []).join("\n"));
          throw new Error(`Transaction failed: ${JSON.stringify(txInfo.meta.err)}`);
        }

        return sig;
      } catch (e: any) {
        if (isAccountInUseLike(e) && attempt < MAX_RETRIES) {
          await sleep(40 * attempt);
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

    // PAY LOOP (nonce range is disjoint from other test suites)
    for (let i = 0; i < ITER; i++) {
      const nonce = BASE_NONCE + i; // ✅ avoids collision with spl_pay.spec.ts nonces
      const nonceBn = new BN(nonce);
      const receipt = payReceiptPda(program.programId, treasuryPda, nonceBn);

      await program.methods
        .splPay(new BN(1), null, null, nonceBn)
        .accounts({
          treasuryAuthority: protocolAuthority.publicKey,
          recipient: recipients[i].publicKey,
          treasury: treasuryPda,
          mint,
          recipientAta: recipientAtas[i],
          treasuryAta,
          receipt,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([protocolAuthority])
        .rpc();

      if (i % 50 === 0) console.log(`sequential ${i}/${ITER}`);
    }

    expect(true).to.eq(true);
  });

  it("bounded concurrency: 300 pays, batch size 5", async () => {
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

        const nonce = BASE_NONCE + 10_000 + idx; // ✅ disjoint from sequential too

        batch.push(sendOnePay(recipients[idx].publicKey, recipientAtas[idx], nonce));
      }

      await Promise.all(batch);
      if (sent % 50 === 0) console.log(`concurrent ${sent}/${TOTAL}`);
    }

    const treasuryAccAfter = await getAccount(provider.connection, treasuryAta);
    console.log("TREASURY ATA AFTER STRESS (raw units):", treasuryAccAfter.amount.toString());

    expect(true).to.eq(true);
  });
});




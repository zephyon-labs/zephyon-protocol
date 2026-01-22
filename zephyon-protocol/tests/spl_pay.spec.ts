import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { Protocol } from "../target/types/protocol";

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
  // single-source-of-truth constants (prevents landmines later)
  DIR_PAY,
  ASSET_SPL,
} from "./_helpers";

const DEBUG = process.env.DEBUG_TESTS === "1";

function toNum(v: any): number {
  if (v instanceof anchor.BN) return v.toNumber();
  return Number(v);
}

function u64LE(n: anchor.BN): Buffer {
  return n.toArrayLike(Buffer, "le", 8);
}

// Pay receipts are PDA'd by: ["receipt", treasuryPda, payCountBefore(u64LE)]
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

describe("protocol - spl pay (Core17)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let program: anchor.Program<Protocol>;

  let treasuryPda: anchor.web3.PublicKey;
  let protocolAuth: Keypair;

  before(async () => {
    program = getProgram() as anchor.Program<Protocol>;

    const foundation = await initFoundationOnce(
      provider as AnchorProvider,
      program as any
    );

    treasuryPda = foundation.treasuryPda;
    protocolAuth = foundation.protocolAuth;
  });

  async function seedTreasury(amount: bigint) {
    // Setup: create mint + seed treasury with funds via deposit
    const funder = Keypair.generate();
    await airdrop(provider, funder.publicKey, 2);

    const { mint, userAta: funderAta, treasuryAta } = await setupMintAndAtas(
      provider,
      funder,
      treasuryPda,
      amount
    );

    await program.methods
      .splDeposit(new anchor.BN(amount.toString()))
      .accounts({
        user: funder.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: funderAta.address,
        treasuryAta: treasuryAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([funder])
      .rpc();

    return { funder, mint, funderAta, treasuryAta };
  }

  it("A) pays SPL from treasury to recipient and writes a receipt", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    // Recipient
    const recipient = Keypair.generate();
    const recipientAta = getAssociatedTokenAddressSync(
      mint,
      recipient.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Get payCount BEFORE the pay (receipt is seeded by this)
    const treasuryAcc = await program.account.treasury.fetch(treasuryPda);
    const payCountBefore = new anchor.BN(treasuryAcc.payCount);

    const receiptPda = payReceiptPda(program.programId, treasuryPda, payCountBefore);

    // Pre balances
    const treasuryBefore = await getAccount(provider.connection, treasuryAta.address);
    const recipientAtaInfoBefore = await provider.connection.getAccountInfo(recipientAta);

    // Execute pay
    const payAmount = 1234;
    await program.methods
      .splPay(new anchor.BN(payAmount))
      .accounts({
        treasuryAuthority: protocolAuth.publicKey,
        recipient: recipient.publicKey,
        treasury: treasuryPda,
        mint,
        recipientAta,
        treasuryAta: treasuryAta.address,
        receipt: receiptPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([protocolAuth])
      .rpc();

    // Recipient ATA should exist after (auto-create)
    expect(recipientAtaInfoBefore).to.eq(null);

    const recipientAfter = await getAccount(provider.connection, recipientAta);
    const treasuryAfter = await getAccount(provider.connection, treasuryAta.address);

    expect(Number(recipientAfter.amount)).to.eq(payAmount);
    expect(Number(treasuryBefore.amount) - Number(treasuryAfter.amount)).to.eq(payAmount);

    // Receipt checks
    const r: any = await (program.account as any).receipt.fetch(receiptPda);

    // amount
    expect(toNum(r.amount)).to.eq(payAmount);

    // direction (use shared constant so TS can't drift from Rust)
    expect(toNum(r.direction)).to.eq(DIR_PAY);

    // asset_kind (IDL camelCases to assetKind)
    const rawAsset = r.assetKind ?? r.asset_kind;
    expect(toNum(rawAsset)).to.eq(ASSET_SPL);

    // v2.splMint should match mint (if your ReceiptV2Ext is populated)
    if (r.v2?.splMint) {
      expect(r.v2.splMint.toBase58()).to.eq(mint.toBase58());
    }
  });

  it("B) clarity: recipient does NOT sign; ATA auto-created if missing", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const recipient = Keypair.generate();
    const recipientAta = getAssociatedTokenAddressSync(
      mint,
      recipient.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Ensure ATA missing up-front (this is the point of the test)
    const beforeInfo = await provider.connection.getAccountInfo(recipientAta);
    expect(beforeInfo).to.eq(null);

    const treasuryAcc = await program.account.treasury.fetch(treasuryPda);
    const payCountBefore = new anchor.BN(treasuryAcc.payCount);
    const receiptPda = payReceiptPda(program.programId, treasuryPda, payCountBefore);

    const treasuryBefore = await getAccount(provider.connection, treasuryAta.address);

    const payAmount = 555;
    // IMPORTANT: recipient does NOT sign
    await program.methods
      .splPay(new anchor.BN(payAmount))
      .accounts({
        treasuryAuthority: protocolAuth.publicKey,
        recipient: recipient.publicKey,
        treasury: treasuryPda,
        mint,
        recipientAta,
        treasuryAta: treasuryAta.address,
        receipt: receiptPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([protocolAuth])
      .rpc();

    // ATA must exist and be funded
    const recipientAfter = await getAccount(provider.connection, recipientAta);
    expect(Number(recipientAfter.amount)).to.eq(payAmount);

    const treasuryAfter = await getAccount(provider.connection, treasuryAta.address);
    expect(Number(treasuryBefore.amount) - Number(treasuryAfter.amount)).to.eq(payAmount);

    // Receipt should exist too (basic sanity)
    const r: any = await (program.account as any).receipt.fetch(receiptPda);
    expect(toNum(r.direction)).to.eq(DIR_PAY);
    const rawAsset = r.assetKind ?? r.asset_kind;
    expect(toNum(rawAsset)).to.eq(ASSET_SPL);
    expect(toNum(r.amount)).to.eq(payAmount);
  });

  it("C) clarity: unauthorized splPay fails", async () => {
    const { funder, mint, treasuryAta } = await seedTreasury(1_000_000n);

    // Attacker is NOT protocolAuth
    const attacker = Keypair.generate();
    await airdrop(provider, attacker.publicKey, 2);

    const recipientAta = getAssociatedTokenAddressSync(
      mint,
      attacker.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Use current payCount for receipt PDA derivation attempt
    const treasuryAcc = await program.account.treasury.fetch(treasuryPda);
    const payCountBefore = new anchor.BN(treasuryAcc.payCount);
    const receiptPda = payReceiptPda(program.programId, treasuryPda, payCountBefore);

    let failed = false;
    try {
      await program.methods
        .splPay(new anchor.BN(1))
        .accounts({
          treasuryAuthority: funder.publicKey, // WRONG signer
          recipient: attacker.publicKey,
          treasury: treasuryPda,
          mint,
          recipientAta,
          treasuryAta: treasuryAta.address,
          receipt: receiptPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([funder])
        .rpc();
    } catch (e: any) {
      failed = true;
      if (DEBUG) console.log("unauthorized splPay failed as expected:", e?.message ?? e);
    }

    expect(failed).to.eq(true);
  });
});

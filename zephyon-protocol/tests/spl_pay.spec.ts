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
  loadProtocolAuthority,
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
async function expectFail(p: Promise<any>) {
  let failed = false;
  try {
    await p;
  } catch {
    failed = true;
  }
  expect(failed).to.eq(true);
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

  const V2_FLAG_HAS_REFERENCE = 1 << 0;
  const V2_FLAG_HAS_MEMO = 1 << 1;


  before(async () => {
   program = getProgram() as anchor.Program<Protocol>;

   const foundation = await initFoundationOnce(provider as AnchorProvider, program as any);
   treasuryPda = foundation.treasuryPda;

   // ✅ authority used for signing must be a Keypair
   protocolAuth = loadProtocolAuthority();

   // MUST be a Keypair (has secretKey)
   if (!protocolAuth?.secretKey) {
    throw new Error("protocolAuth is not a Keypair (no secretKey) — cannot sign");
 }

   // ✅ sanity: on-chain treasury authority must match our signer pubkey
   const t: any = await program.account.treasury.fetch(treasuryPda);
   expect(t.authority.toBase58()).to.eq(protocolAuth.publicKey.toBase58());
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

    const receiptPda = payReceiptPda(
      program.programId,
      treasuryPda,
      payCountBefore
    );

    // Pre balances
    const treasuryBefore = await getAccount(
      provider.connection,
      treasuryAta.address
    );
    const recipientAtaInfoBefore = await provider.connection.getAccountInfo(
      recipientAta
    );

    // Execute pay
    const payAmount = 1234;
    await program.methods
      .splPay(new anchor.BN(payAmount), null, null)
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
    const treasuryAfter = await getAccount(
      provider.connection,
      treasuryAta.address
    );

    expect(Number(recipientAfter.amount)).to.eq(payAmount);
    expect(Number(treasuryBefore.amount) - Number(treasuryAfter.amount)).to.eq(
      payAmount
    );

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
    const receiptPda = payReceiptPda(
      program.programId,
      treasuryPda,
      payCountBefore
    );

    const treasuryBefore = await getAccount(
      provider.connection,
      treasuryAta.address
    );

    const payAmount = 555;
    // IMPORTANT: recipient does NOT sign
    await program.methods
      .splPay(new anchor.BN(payAmount), null, null)
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

    const treasuryAfter = await getAccount(
      provider.connection,
      treasuryAta.address
    );
    expect(Number(treasuryBefore.amount) - Number(treasuryAfter.amount)).to.eq(
      payAmount
    );

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
    const receiptPda = payReceiptPda(
      program.programId,
      treasuryPda,
      payCountBefore
    );

    let failed = false;
    try {
      await program.methods
        .splPay(new anchor.BN(1), null, null)
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
      if (DEBUG)
        console.log("unauthorized splPay failed as expected:", e?.message ?? e);
    }

    expect(failed).to.eq(true);
  });

  it("D) clarity: pay_count increments and receipt PDA shifts", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    // Recipient (doesn't sign)
    const recipient = Keypair.generate();
    const recipientAta = getAssociatedTokenAddressSync(
      mint,
      recipient.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // payCount BEFORE
    const tBefore: any = await program.account.treasury.fetch(treasuryPda);
    const payCountBefore = new anchor.BN(tBefore.payCount);

    const receiptPda1 = payReceiptPda(
      program.programId,
      treasuryPda,
      payCountBefore
    );

    // Execute pay #1
    await program.methods
      .splPay(new anchor.BN(111), null, null)
      .accounts({
        treasuryAuthority: protocolAuth.publicKey,
        recipient: recipient.publicKey,
        treasury: treasuryPda,
        mint,
        recipientAta,
        treasuryAta: treasuryAta.address,
        receipt: receiptPda1,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([protocolAuth])
      .rpc();

    // payCount AFTER should be +1
    const tAfter: any = await program.account.treasury.fetch(treasuryPda);
    const payCountAfter = new anchor.BN(tAfter.payCount);

    expect(payCountAfter.toNumber()).to.eq(payCountBefore.toNumber() + 1);

    // Receipt PDA for next pay should be different (shift)
    const receiptPda2 = payReceiptPda(
      program.programId,
      treasuryPda,
      payCountAfter
    );
    expect(receiptPda1.toBase58()).to.not.eq(receiptPda2.toBase58());

    // Optional sanity: the receipt at receiptPda1 exists and is DIR_PAY/ASSET_SPL
    const r1: any = await (program.account as any).receipt.fetch(receiptPda1);
    expect(toNum(r1.direction)).to.eq(DIR_PAY);
    const rawAsset = r1.assetKind ?? r1.asset_kind;
    expect(toNum(rawAsset)).to.eq(ASSET_SPL);
    expect(toNum(r1.amount)).to.eq(111);

    // Balance sanity (treasury decreased, recipient increased at least 111)
    const treasuryAfter = await getAccount(provider.connection, treasuryAta.address);
    // Can't reliably assert exact recipient total across all prior tests, but can ensure it's >= 111
    const recipientAfter = await getAccount(provider.connection, recipientAta);
    expect(Number(recipientAfter.amount)).to.be.gte(111);

    if (DEBUG) {
      console.log("payCountBefore:", payCountBefore.toString());
      console.log("payCountAfter:", payCountAfter.toString());
      console.log("receiptPda1:", receiptPda1.toBase58());
      console.log("receiptPda2:", receiptPda2.toBase58());
      console.log("treasuryAfter:", Number(treasuryAfter.amount));
    }
  });

    it("E) clarity: splPay amount=0 fails", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const recipient = Keypair.generate();
    const recipientAta = getAssociatedTokenAddressSync(
      mint,
      recipient.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const t = await program.account.treasury.fetch(treasuryPda);
    const payCountBefore = new anchor.BN((t as any).payCount);
    const receiptPda = payReceiptPda(program.programId, treasuryPda, payCountBefore);

    await expectFail(
      program.methods
        .splPay(new anchor.BN(0), null, null)
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
        .rpc()
    );
  });


  it("F) clarity: splPay fails while treasury is paused", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const t0: any = await program.account.treasury.fetch(treasuryPda);
  expect(t0.authority.toBase58()).to.eq(protocolAuth.publicKey.toBase58());

  if (!protocolAuth.secretKey) throw new Error("protocolAuth is not a Keypair");



    // pause treasury
    await program.methods
    .setTreasuryPaused(true)
    .accounts({
      treasuryAuthority: protocolAuth.publicKey,
      treasury: treasuryPda,
    } as any)
    .signers([protocolAuth])
    .rpc();

    const recipient = Keypair.generate();
    const recipientAta = getAssociatedTokenAddressSync(
      mint,
      recipient.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const t = await program.account.treasury.fetch(treasuryPda);
    const payCountBefore = new anchor.BN((t as any).payCount);
    const receiptPda = payReceiptPda(program.programId, treasuryPda, payCountBefore);

    await expectFail(
      program.methods
        .splPay(new anchor.BN(1), null, null)
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
        .rpc()
    );

    // unpause to avoid contaminating other tests
    await program.methods
    .setTreasuryPaused(false)
    .accounts({
      treasuryAuthority: protocolAuth.publicKey,
      treasury: treasuryPda,
    } as any)
    .signers([protocolAuth])
    .rpc();
  });

  it("G) clarity: splPay fails if treasury has insufficient funds", async () => {
    // seed small amount
    const { mint, treasuryAta } = await seedTreasury(100n);

    const recipient = Keypair.generate();
    const recipientAta = getAssociatedTokenAddressSync(
      mint,
      recipient.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const t = await program.account.treasury.fetch(treasuryPda);
    const payCountBefore = new anchor.BN((t as any).payCount);
    const receiptPda = payReceiptPda(program.programId, treasuryPda, payCountBefore);

    // try to pay more than treasury has
    await expectFail(
      program.methods
        .splPay(new anchor.BN(101), null, null)
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
        .rpc()
    );
  });

  it("H) clarity: splPay to treasuryAuthority is allowed (pay-to-self policy)", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    // recipient is the authority itself
    const recipientAta = getAssociatedTokenAddressSync(
      mint,
      protocolAuth.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const beforeInfo = await provider.connection.getAccountInfo(recipientAta);
    // may be null if ATA doesn't exist yet (fine either way)

    const t = await program.account.treasury.fetch(treasuryPda);
    const payCountBefore = new anchor.BN((t as any).payCount);
    const receiptPda = payReceiptPda(program.programId, treasuryPda, payCountBefore);

    const treasuryBefore = await getAccount(provider.connection, treasuryAta.address);

    const payAmount = 777;
    await program.methods
      .splPay(new anchor.BN(payAmount), null, null)
      .accounts({
        treasuryAuthority: protocolAuth.publicKey,
        recipient: protocolAuth.publicKey,
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

    const recipientAfter = await getAccount(provider.connection, recipientAta);
    const treasuryAfter = await getAccount(provider.connection, treasuryAta.address);

    expect(Number(recipientAfter.amount)).to.be.gte(payAmount);
    expect(Number(treasuryBefore.amount) - Number(treasuryAfter.amount)).to.eq(payAmount);

    // (optional) if ATA didn't exist before, now it must
    if (beforeInfo === null) {
      const afterInfo = await provider.connection.getAccountInfo(recipientAta);
      expect(afterInfo).to.not.eq(null);
    }
  });

  it("Core21) splPay writes reference + memo metadata into receipt.v2", async () => {
  const { mint, treasuryAta } = await seedTreasury(1_000_000n);

  const recipient = Keypair.generate();
  const recipientAta = getAssociatedTokenAddressSync(
    mint,
    recipient.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const treasuryAcc = await program.account.treasury.fetch(treasuryPda);
  const payCountBefore = new anchor.BN(treasuryAcc.payCount);
  const receiptPda = payReceiptPda(program.programId, treasuryPda, payCountBefore);

  const reference = Buffer.from(new Uint8Array(32).fill(7));

  const memo = Buffer.from("invoice:1234|core21", "utf8");


  await program.methods
    .splPay(new anchor.BN(777), Array.from(reference), memo)


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

  const r: any = await (program.account as any).receipt.fetch(receiptPda);

  expect(toNum(r.v2.flags)).to.eq(V2_FLAG_HAS_REFERENCE | V2_FLAG_HAS_MEMO);
  expect(Array.from(r.v2.reference)).to.deep.eq(Array.from(reference));
  expect(toNum(r.v2.memoLen)).to.eq(memo.length);

  const gotMemo = Uint8Array.from(r.v2.memo).slice(0, toNum(r.v2.memoLen));
  expect(Array.from(gotMemo)).to.deep.eq(Array.from(memo));
});

it("Core21) splPay with null metadata stores empty v2 fields", async () => {
  const { mint, treasuryAta } = await seedTreasury(1_000_000n);

  const recipient = Keypair.generate();
  const recipientAta = getAssociatedTokenAddressSync(
    mint,
    recipient.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const treasuryAcc = await program.account.treasury.fetch(treasuryPda);
  const payCountBefore = new anchor.BN(treasuryAcc.payCount);
  const receiptPda = payReceiptPda(program.programId, treasuryPda, payCountBefore);

  await program.methods
    .splPay(new anchor.BN(42), null, null)
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

  const r: any = await (program.account as any).receipt.fetch(receiptPda);

  expect(toNum(r.v2.flags)).to.eq(0);
  expect(toNum(r.v2.memoLen)).to.eq(0);
  expect(Array.from(r.v2.reference)).to.deep.eq(Array.from(new Uint8Array(32)));
});

it("Core21) splPay rejects memo > 64 bytes", async () => {
  const { mint, treasuryAta } = await seedTreasury(1_000_000n);

  const recipient = Keypair.generate();
  const recipientAta = getAssociatedTokenAddressSync(
    mint,
    recipient.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const treasuryAcc = await program.account.treasury.fetch(treasuryPda);
  const payCountBefore = new anchor.BN(treasuryAcc.payCount);
  const receiptPda = payReceiptPda(program.programId, treasuryPda, payCountBefore);

  const reference = new Uint8Array(32).fill(1);
  const tooLongMemo = new Uint8Array(65).fill(9);

  let threw = false;
  try {
    await program.methods
      .splPay(new anchor.BN(1), Array.from(reference), Buffer.from(tooLongMemo))

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
  } catch (e: any) {
    threw = true;
    expect(String(e).toLowerCase()).to.include("memo too long");
  }
  expect(threw).to.eq(true);
});


});


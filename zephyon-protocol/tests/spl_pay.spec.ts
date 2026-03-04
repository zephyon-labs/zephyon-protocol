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
  // single-source-of-truth constants
  DIR_PAY,
  ASSET_SPL,
} from "./_helpers";

const DEBUG = process.env.DEBUG_TESTS === "1";

function toNum(v: any): number {
  if (v instanceof anchor.BN) return v.toNumber();
  return Number(v);
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

/**
 * Canonical receipt PDA (matches CURRENT Rust):
 * seeds = ["receipt", treasury, treasury.pay_count (LE u64)]
 */
function receiptPdaPayCount(
  programId: PublicKey,
  treasuryPda: PublicKey,
  payCountBefore: anchor.BN
): PublicKey {
  const le = payCountBefore.toArrayLike(Buffer, "le", 8);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), treasuryPda.toBuffer(), le],
    programId
  );
  return pda;
}

/**
 * Canonical splPay call (matches CURRENT Rust):
 * splPay(amount, reference, memo)
 * - reference: Option<[u8; 32]> => pass null OR number[32]
 * - memo: Option<Vec<u8>> => pass null OR Buffer/Uint8Array
 */
function splPay3(
  program: any,
  amount: anchor.BN,
  reference: number[] | null,
  memo: Buffer | Uint8Array | null
) {
  return program.methods.splPay(amount, reference, memo);
}

describe("protocol - spl pay (Core17)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let program: anchor.Program<Protocol>;
  let programAny: any;

  let treasuryPda: anchor.web3.PublicKey;
  let protocolAuth: Keypair;

  const V2_FLAG_HAS_REFERENCE = 1 << 0;
  const V2_FLAG_HAS_MEMO = 1 << 1;

  before(async () => {
    program = getProgram() as anchor.Program<Protocol>;
    programAny = program as any;

    const foundation = await initFoundationOnce(
      provider as AnchorProvider,
      program as any
    );
    treasuryPda = foundation.treasuryPda;

    protocolAuth = loadProtocolAuthority();

    if (!protocolAuth?.secretKey) {
      throw new Error("protocolAuth is not a Keypair (no secretKey) — cannot sign");
    }

    const t: any = await program.account.treasury.fetch(treasuryPda);
    expect(t.authority.toBase58()).to.eq(protocolAuth.publicKey.toBase58());
  });

  async function seedTreasury(amount: bigint) {
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

  async function payCountBeforeAndReceipt(mint: PublicKey, recipient: PublicKey) {
    const t: any = await (program.account as any).treasury.fetch(treasuryPda);
    const payCountBefore = new anchor.BN(t.payCount);

    const recipientAta = getAssociatedTokenAddressSync(
      mint,
      recipient,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const receiptPda = receiptPdaPayCount(program.programId, treasuryPda, payCountBefore);
    return { payCountBefore, receiptPda, recipientAta };
  }

  it("A) pays SPL from treasury to recipient and writes a receipt", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const recipient = Keypair.generate();
    const { receiptPda, recipientAta } = await payCountBeforeAndReceipt(mint, recipient.publicKey);

    const treasuryBefore = await getAccount(provider.connection, treasuryAta.address);
    const recipientAtaInfoBefore = await provider.connection.getAccountInfo(recipientAta);

    const payAmount = 1234;

    await splPay3(programAny, new anchor.BN(payAmount), null, null)
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

    expect(recipientAtaInfoBefore).to.eq(null);

    const recipientAfter = await getAccount(provider.connection, recipientAta);
    const treasuryAfter = await getAccount(provider.connection, treasuryAta.address);

    expect(Number(recipientAfter.amount)).to.eq(payAmount);
    expect(Number(treasuryBefore.amount) - Number(treasuryAfter.amount)).to.eq(payAmount);

    const r: any = await (program.account as any).receipt.fetch(receiptPda);
    expect(toNum(r.amount)).to.eq(payAmount);
    expect(toNum(r.direction)).to.eq(DIR_PAY);

    const rawAsset = r.assetKind ?? r.asset_kind;
    expect(toNum(rawAsset)).to.eq(ASSET_SPL);

    if (r.v2?.splMint) {
      expect(r.v2.splMint.toBase58()).to.eq(mint.toBase58());
    }
  });

  it("B) clarity: recipient does NOT sign; ATA auto-created if missing", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const recipient = Keypair.generate();
    const { receiptPda, recipientAta } = await payCountBeforeAndReceipt(mint, recipient.publicKey);

    const beforeInfo = await provider.connection.getAccountInfo(recipientAta);
    expect(beforeInfo).to.eq(null);

    const treasuryBefore = await getAccount(provider.connection, treasuryAta.address);

    const payAmount = 555;

    await splPay3(programAny, new anchor.BN(payAmount), null, null)
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

    const recipientAfter = await getAccount(provider.connection, recipientAta);
    expect(Number(recipientAfter.amount)).to.eq(payAmount);

    const treasuryAfter = await getAccount(provider.connection, treasuryAta.address);
    expect(Number(treasuryBefore.amount) - Number(treasuryAfter.amount)).to.eq(payAmount);

    const r: any = await (program.account as any).receipt.fetch(receiptPda);
    expect(toNum(r.direction)).to.eq(DIR_PAY);

    const rawAsset = r.assetKind ?? r.asset_kind;
    expect(toNum(rawAsset)).to.eq(ASSET_SPL);
    expect(toNum(r.amount)).to.eq(payAmount);
  });

  it("C) clarity: unauthorized splPay fails", async () => {
    const { funder, mint, treasuryAta } = await seedTreasury(1_000_000n);

    const attacker = Keypair.generate();
    await airdrop(provider, attacker.publicKey, 2);

    const { receiptPda, recipientAta } = await payCountBeforeAndReceipt(mint, attacker.publicKey);

    await expectFail(
      splPay3(programAny, new anchor.BN(1), null, null)
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
        .rpc()
    );
  });

  it("D) clarity: pay_count increments (receipt PDA is payCount-based)", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const recipient = Keypair.generate();
    const recipientAta = getAssociatedTokenAddressSync(
      mint,
      recipient.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const tBefore: any = await program.account.treasury.fetch(treasuryPda);
    const payCountBefore = new anchor.BN(tBefore.payCount);
    const receiptPda1 = receiptPdaPayCount(program.programId, treasuryPda, payCountBefore);

    await splPay3(programAny, new anchor.BN(111), null, null)
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

    const tAfter: any = await program.account.treasury.fetch(treasuryPda);
    const payCountAfter = new anchor.BN(tAfter.payCount);
    expect(payCountAfter.toNumber()).to.eq(payCountBefore.toNumber() + 1);

    const receiptPda2 = receiptPdaPayCount(program.programId, treasuryPda, payCountAfter);
    expect(receiptPda1.toBase58()).to.not.eq(receiptPda2.toBase58());

    const r1: any = await (program.account as any).receipt.fetch(receiptPda1);
    expect(toNum(r1.direction)).to.eq(DIR_PAY);

    const rawAsset = r1.assetKind ?? r1.asset_kind;
    expect(toNum(rawAsset)).to.eq(ASSET_SPL);
    expect(toNum(r1.amount)).to.eq(111);

    if (DEBUG) {
      const treasuryAfterAcc = await getAccount(provider.connection, treasuryAta.address);
      const recipientAfterAcc = await getAccount(provider.connection, recipientAta);
      console.log("payCountBefore:", payCountBefore.toString());
      console.log("payCountAfter:", payCountAfter.toString());
      console.log("receiptPda1:", receiptPda1.toBase58());
      console.log("receiptPda2:", receiptPda2.toBase58());
      console.log("treasuryAfter:", Number(treasuryAfterAcc.amount));
      console.log("recipientAfter:", Number(recipientAfterAcc.amount));
    }
  });

  it("E) clarity: splPay amount=0 fails", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const recipient = Keypair.generate();
    const { receiptPda, recipientAta } = await payCountBeforeAndReceipt(mint, recipient.publicKey);

    await expectFail(
      splPay3(programAny, new anchor.BN(0), null, null)
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
    const { mint } = await seedTreasury(1_000_000n);

    const t0: any = await program.account.treasury.fetch(treasuryPda);
    expect(t0.authority.toBase58()).to.eq(protocolAuth.publicKey.toBase58());

    await program.methods
      .setTreasuryPaused(true)
      .accounts({
        treasuryAuthority: protocolAuth.publicKey,
        treasury: treasuryPda,
      } as any)
      .signers([protocolAuth])
      .rpc();

    const recipient = Keypair.generate();
    const { receiptPda, recipientAta } = await payCountBeforeAndReceipt(mint, recipient.publicKey);

    await expectFail(
      splPay3(programAny, new anchor.BN(1), null, null)
        .accounts({
          treasuryAuthority: protocolAuth.publicKey,
          recipient: recipient.publicKey,
          treasury: treasuryPda,
          mint,
          recipientAta,
          treasuryAta: getAssociatedTokenAddressSync(
            mint,
            treasuryPda,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          ),
          receipt: receiptPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([protocolAuth])
        .rpc()
    );

    await program.methods
      .setTreasuryPaused(false)
      .accounts({
        treasuryAuthority: protocolAuth.publicKey,
        treasury: treasuryPda,
      } as any)
      .signers([protocolAuth])
      .rpc();
  });

  it("Core21) splPay writes reference + memo metadata into receipt.v2", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const recipient = Keypair.generate();
    const { receiptPda, recipientAta } = await payCountBeforeAndReceipt(mint, recipient.publicKey);

    const reference = new Array(32).fill(7); // number[32]
    const memoBuf = Buffer.from("invoice:1234|core21", "utf8"); // Buffer

    await splPay3(programAny, new anchor.BN(777), reference, memoBuf)
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
    expect(Array.from(r.v2.reference)).to.deep.eq(reference);
    expect(toNum(r.v2.memoLen)).to.eq(memoBuf.length);

    const gotMemo = Uint8Array.from(r.v2.memo).slice(0, toNum(r.v2.memoLen));
    expect(Array.from(gotMemo)).to.deep.eq(Array.from(memoBuf));
  });

  it("Core21) splPay with null metadata stores empty v2 fields", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const recipient = Keypair.generate();
    const { receiptPda, recipientAta } = await payCountBeforeAndReceipt(mint, recipient.publicKey);

    await splPay3(programAny, new anchor.BN(42), null, null)
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
    const { receiptPda, recipientAta } = await payCountBeforeAndReceipt(mint, recipient.publicKey);

    const reference = new Array(32).fill(1);
    const tooLongMemo = Buffer.from(new Uint8Array(65).fill(9)); // Buffer so it reaches Rust

    let threw = false;
    try {
      await splPay3(programAny, new anchor.BN(1), reference, tooLongMemo)
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
      const msg = String(e?.message ?? e).toLowerCase();
      expect(msg).to.satisfy((m: string) => m.includes("memo too long") || m.includes("memotoolong"));
      if (DEBUG) console.log("memo>64 threw as expected:", msg);
    }
    expect(threw).to.eq(true);
  });
});

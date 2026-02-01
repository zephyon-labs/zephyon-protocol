import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import {
  loadProtocolAuthority,
  airdrop,
  DIR_DEPOSIT,
  ASSET_SPL,
} from "./_helpers";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

import { Protocol } from "../target/types/protocol";

function u64LE(n: anchor.BN): Buffer {
  return n.toArrayLike(Buffer, "le", 8);
}

// Derive deposit receipt PDA (deposit-with-receipt uses nonce-seeded receipt)
function depositReceiptPda(
  programId: PublicKey,
  user: PublicKey,
  nonce: anchor.BN
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), user.toBuffer(), u64LE(nonce)],
    programId
  );
  return pda;
}

// Nonce generator that avoids PDA collisions across repeated test runs
function makeUniqueNonce(): anchor.BN {
  return new anchor.BN(Date.now());
}

function toNum(v: any): number {
  if (v instanceof anchor.BN) return v.toNumber();
  return Number(v);
}

describe("protocol - spl deposit with receipt", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as Program<Protocol>;
  const payer = (provider.wallet as any).payer as anchor.web3.Keypair;

  it("deposits SPL and writes a receipt (nonce-seeded)", async () => {
    // --- Treasury PDA
    const [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );

    // --- Mint + ATAs
    const mint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6
    );

    const userAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      payer.publicKey
    );

    const treasuryAtaAddr = getAssociatedTokenAddressSync(mint, treasuryPda, true);

    // Ensure treasury ATA exists (keeps test deterministic)
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      treasuryPda,
      true
    );

    // --- Ensure treasury is initialized (MUST be protocol authority, not payer)
    const protocolAuth = loadProtocolAuthority();
    await airdrop(provider, protocolAuth.publicKey, 2);

    try {
      await program.methods
        .initializeTreasury()
        .accounts({
          authority: protocolAuth.publicKey,
          treasury: treasuryPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([protocolAuth])
        .rpc();
    } catch (_e) {
      // Treasury likely already exists — safe to ignore
    }

    // --- Seed user funds
    const amount = 1_000_000;
    await mintTo(provider.connection, payer, mint, userAta.address, payer, amount);

    // --- Nonce + receipt PDA
    const nonce = makeUniqueNonce();
    const receiptPda = depositReceiptPda(program.programId, payer.publicKey, nonce);

    // --- Pre-balances
    const userBefore = await getAccount(provider.connection, userAta.address);
    const treasuryBefore = await getAccount(provider.connection, treasuryAtaAddr);

    // --- Deposit with receipt
    await program.methods
      .splDepositWithReceipt(new anchor.BN(amount), nonce)
      .accounts({
        user: payer.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAtaAddr,
        receipt: receiptPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([payer])
      .rpc();

    // --- Receipt exists + basic correctness
    const r: any = await (program.account as any).receipt.fetch(receiptPda);


    const rr = r;


  // amount
  const rawAmount = rr.amount;
  const rAmount = toNum(rawAmount);

  if (rAmount !== amount) {
    const fee = toNum(rr.fee);
    const pre = toNum(rr.preBalance);
    const post = toNum(rr.postBalance);
    throw new Error(
      `receipt amount mismatch: got=${rAmount} expected=${amount} raw=${rawAmount} fee=${fee} pre=${pre} post=${post}`
    );
  }

  // asset_kind
  const rawAsset = rr.assetKind ?? rr.asset_kind;
  const asset = toNum(rawAsset);
  if (asset !== ASSET_SPL) {
    throw new Error(`receipt asset_kind mismatch: got=${asset} expected=${ASSET_SPL}`);
  }

    // direction
    const dir = toNum(rr.direction);
    if (dir !== DIR_DEPOSIT) {
      throw new Error(`receipt direction mismatch: got=${dir} expected=${DIR_DEPOSIT}`);
  }
    const userAfter = await getAccount(provider.connection, userAta.address);
    const treasuryAfter = await getAccount(provider.connection, treasuryAtaAddr);


    
    if (Number(userBefore.amount) - Number(userAfter.amount) !== amount) {
      throw new Error("user ATA did not decrease by expected amount");
    }
    if (Number(treasuryAfter.amount) - Number(treasuryBefore.amount) !== amount) {
      throw new Error("treasury ATA did not increase by expected amount");
    }
  });
  it("Core25) emits DepositEvent semantics (direction + assetKind)", async () => {
  // --- Treasury PDA
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId
  );

  // --- Mint + ATAs
  const mint = await createMint(provider.connection, payer, payer.publicKey, null, 6);

  const userAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    mint,
    payer.publicKey
  );

  const treasuryAtaAddr = getAssociatedTokenAddressSync(mint, treasuryPda, true);

  // Ensure treasury ATA exists (keeps test deterministic)
  await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    mint,
    treasuryPda,
    true
  );

  // --- Ensure treasury is initialized (MUST be protocol authority, not payer)
  const protocolAuth = loadProtocolAuthority();
  await airdrop(provider, protocolAuth.publicKey, 2);

  try {
    await program.methods
      .initializeTreasury()
      .accounts({
        authority: protocolAuth.publicKey,
        treasury: treasuryPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([protocolAuth])
      .rpc();
  } catch (_e) {
    // Treasury likely already exists — safe to ignore
  }

  // --- Seed user funds
  const amount = 1_000_000;
  await mintTo(provider.connection, payer, mint, userAta.address, payer, amount);

  // --- Nonce + receipt PDA
  const nonce = makeUniqueNonce();
  const receiptPda = depositReceiptPda(program.programId, payer.publicKey, nonce);

  // --- Deposit with receipt (CAPTURE txSig)
  const txSig = await program.methods
    .splDepositWithReceipt(new anchor.BN(amount), nonce)
    .accounts({
      user: payer.publicKey,
      treasury: treasuryPda,
      mint,
      userAta: userAta.address,
      treasuryAta: treasuryAtaAddr,
      receipt: receiptPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .signers([payer])
    .rpc();

  await provider.connection.confirmTransaction(txSig, "confirmed");

  const tx = await provider.connection.getTransaction(txSig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  } as any);

  if (!tx) throw new Error("Core25: getTransaction returned null (even after confirm)");

  const logs = tx.meta?.logMessages ?? [];

  // --- Canonical Anchor event parsing (handles CPI nesting correctly)
  const parser = new anchor.EventParser(program.programId, program.coder);
  const events: any[] = [];
  for (const evt of parser.parseLogs(logs)) {
  events.push(evt);
}


  // DepositEvent name can appear as "depositEvent" (common) depending on IDL casing.
  const depEvt = events.find(
    (e) => String(e?.name ?? "").toLowerCase() === "depositevent"
  );

  if (!depEvt) {
    const names = events.map((e) => e?.name).filter(Boolean);
    throw new Error(`Core25: DepositEvent not found. Events seen: ${names.join(", ")}`);
  }

  const event: any = depEvt.data;

  // --- Core25 semantics
  // PayDirection::RecipientToTreasury should decode to { recipientToTreasury: {} }
  expect(event.direction).to.have.property("userToTreasury");

  // AssetKind::SPL should decode to { spl: {} }
  expect(event.assetKind).to.have.property("spl");

  // --- Sanity checks (cheap + high signal)
  expect(event.user.toBase58()).to.eq(payer.publicKey.toBase58());
  expect(event.treasury.toBase58()).to.eq(treasuryPda.toBase58());
  expect(event.mint.toBase58()).to.eq(mint.toBase58());
  expect(toNum(event.amount)).to.eq(amount);

  // Receipt pointer should be deterministic (we passed it in)
  expect(event.receipt.toBase58()).to.eq(receiptPda.toBase58());
});

});




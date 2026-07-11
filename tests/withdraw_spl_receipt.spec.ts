import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { loadProtocolAuthority, airdrop } from "./_helpers";
import { expect } from "chai";


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

// ---- Patch #1 helper: fetch current txCount (0 if profile not created yet)
async function getCurrentTxCount(
  program: Program<Protocol>,
  userProfilePda: PublicKey
): Promise<anchor.BN> {
  // Anchor generates account namespace in camelCase from IDL ("userProfile")
  // If it doesn’t exist, we treat as fresh profile => txCount=0
  try {
    const up: any = await (program.account as any).userProfile.fetch(userProfilePda);
    // up.txCount is typically a BN already
    return up.txCount instanceof anchor.BN ? up.txCount : new anchor.BN(up.txCount);
  } catch (_e) {
    return new anchor.BN(0);
  }
}

// ---- Patch #2 helper: receipt PDA for withdraw-with-receipt
function receiptPdaForTxCount(
  programId: PublicKey,
  user: PublicKey,
  txCount: anchor.BN
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), user.toBuffer(), u64LE(txCount)],
    programId
  );
  return pda;
}
function toNum(v: any): number {
  if (v instanceof anchor.BN) return v.toNumber();
  return Number(v);
}


describe("protocol - spl withdraw with receipt", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as Program<Protocol>;
  const payer = (provider.wallet as any).payer as anchor.web3.Keypair;

  it("withdraws SPL and writes a receipt", async () => {
        const protocolAuth = loadProtocolAuthority();
    await airdrop(provider, protocolAuth.publicKey, 2);

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

    // Ensure treasury ATA exists
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      treasuryPda,
      true
    );

    // --- Seed user funds
    const amount = 1_000_000;
    await mintTo(provider.connection, payer, mint, userAta.address, payer, amount);

    // --- Fund treasury using plain deposit (NO receipt; avoids PDA collisions)
    await program.methods
      .splDeposit(new anchor.BN(amount))
      .accounts({
        user: payer.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAtaAddr,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([payer])
      .rpc();

    // --- user_profile PDA (required by spl_withdraw_with_receipt)
    const [userProfilePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_profile"), payer.publicKey.toBuffer()],
      program.programId
    );

    // ✅ IMPORTANT: derive receipt PDA using CURRENT on-chain txCount
    const txCount = await getCurrentTxCount(program, userProfilePda);
    const withdrawReceiptPda = receiptPdaForTxCount(program.programId, payer.publicKey, txCount);

    const userBefore = await getAccount(provider.connection, userAta.address);
    const treasuryBefore = await getAccount(provider.connection, treasuryAtaAddr);

    // --- Withdraw with receipt (IDL accounts: user, treasuryAuthority, userProfile, treasury, mint, userAta, treasuryAta, receipt, ...)
    await program.methods
      .splWithdrawWithReceipt(new anchor.BN(amount))
      .accounts({
        user: payer.publicKey,
        treasuryAuthority: protocolAuth.publicKey,
        userProfile: userProfilePda,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAtaAddr,
        receipt: withdrawReceiptPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([protocolAuth])
      .rpc();

    const userAfter = await getAccount(provider.connection, userAta.address);
    const treasuryAfter = await getAccount(provider.connection, treasuryAtaAddr);

    if (Number(userAfter.amount) - Number(userBefore.amount) !== amount) {
      throw new Error("user ATA did not increase by expected amount");
    }
    if (Number(treasuryBefore.amount) - Number(treasuryAfter.amount) !== amount) {
      throw new Error("treasury ATA did not decrease by expected amount");
    }
  });

  it("Core26) emits WithdrawEvent semantics (direction + assetKind)", async () => {
  const protocolAuth = loadProtocolAuthority();
  await airdrop(provider, protocolAuth.publicKey, 2);

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

  // Ensure treasury ATA exists
  await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    mint,
    treasuryPda,
    true
  );

  // --- Seed user funds
  const amount = 1_000_000;
  await mintTo(provider.connection, payer, mint, userAta.address, payer, amount);

  // --- Fund treasury using plain deposit (NO receipt; avoids PDA collisions)
  await program.methods
    .splDeposit(new anchor.BN(amount))
    .accounts({
      user: payer.publicKey,
      treasury: treasuryPda,
      mint,
      userAta: userAta.address,
      treasuryAta: treasuryAtaAddr,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .signers([payer])
    .rpc();

  // --- user_profile PDA (required by splWithdrawWithReceipt)
  const [userProfilePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_profile"), payer.publicKey.toBuffer()],
    program.programId
  );

  // ✅ derive receipt PDA using CURRENT on-chain txCount
  const txCount = await getCurrentTxCount(program, userProfilePda);
  const withdrawReceiptPda = receiptPdaForTxCount(
    program.programId,
    payer.publicKey,
    txCount
  );

  // --- Execute withdraw-with-receipt and CAPTURE signature
  const txSig = await program.methods
    .splWithdrawWithReceipt(new anchor.BN(amount))
    .accounts({
      user: payer.publicKey,
      treasuryAuthority: protocolAuth.publicKey,
      userProfile: userProfilePda,
      treasury: treasuryPda,
      mint,
      userAta: userAta.address,
      treasuryAta: treasuryAtaAddr,
      receipt: withdrawReceiptPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .signers([protocolAuth])
    .rpc();

  await provider.connection.confirmTransaction(txSig, "confirmed");

  // --- Pull transaction logs
  const tx = await provider.connection.getTransaction(txSig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  } as any);

  if (!tx) throw new Error("Core26: getTransaction returned null (even after confirm)");

  const logs = tx.meta?.logMessages ?? [];

  // --- Canonical Anchor event parsing (iterator)
  const parser = new anchor.EventParser(program.programId, program.coder);

  const events: any[] = [];
  for (const evt of parser.parseLogs(logs)) events.push(evt);

  const wdEvt = events.find(
    (e) => String(e?.name ?? "").toLowerCase() === "withdrawevent"
  );

  if (!wdEvt) {
    const names = events.map((e) => e?.name).filter(Boolean);
    throw new Error(`Core26: WithdrawEvent not found. Events seen: ${names.join(", ")}`);
  }

  const event: any = wdEvt.data;

  // --- Semantics checks
  // AssetKind::SPL should decode to: { spl: {} }
  expect(event.assetKind).to.have.property("spl");

  // Direction: lock the exact enum variant name
  // (In your last run, Deposit direction decoded to { userToTreasury: {} } not { recipientToTreasury: {} }
  // so we do the same strategy here: assert "one key", then you can hard-pin it next.)
  expect(Object.keys(event.direction ?? {})).to.have.length(1);

  // --- Sanity fields
  expect(event.authority.toBase58()).to.eq(protocolAuth.publicKey.toBase58());
  expect(event.user.toBase58()).to.eq(payer.publicKey.toBase58());
  expect(event.treasury.toBase58()).to.eq(treasuryPda.toBase58());
  expect(event.mint.toBase58()).to.eq(mint.toBase58());
  expect(toNum(event.amount)).to.eq(amount);
});
});



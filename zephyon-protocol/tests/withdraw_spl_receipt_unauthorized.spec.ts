import anchorPkg from "@coral-xyz/anchor";
const anchor = anchorPkg as typeof import("@coral-xyz/anchor");

import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";

import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";

describe("protocol - spl withdraw with receipt unauthorized", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as any;

  it("ATTACK: attacker tries to withdraw-with-receipt from treasury; should FAIL if protected", async () => {
    // ─────────────────────────────────────────────
    // 0) Two actors: victim funds treasury, attacker tries to steal
    // ─────────────────────────────────────────────
    const victim = Keypair.generate();
    const attacker = Keypair.generate();

    // fund both wallets
    {
      const sig1 = await provider.connection.requestAirdrop(
        victim.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig1, "confirmed");

      const sig2 = await provider.connection.requestAirdrop(
        attacker.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig2, "confirmed");
    }

    // treasury pda
    const [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );

    // init treasury idempotent
    try {
      await program.methods
        .initializeTreasury()
        .accounts({
          authority: provider.wallet.publicKey,
          treasury: treasuryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch {}

    // ─────────────────────────────────────────────
    // 1) Mint + ATAs
    // ─────────────────────────────────────────────
    const mint = await createMint(
      provider.connection,
      victim,
      victim.publicKey,
      null,
      6
    );

    const victimAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      victim,
      mint,
      victim.publicKey
    );

    const attackerAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      attacker,
      mint,
      attacker.publicKey
    );

    const treasuryAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      victim,
      mint,
      treasuryPda,
      true
    );

    // ─────────────────────────────────────────────
    // 2) Victim funds treasury (deposit with receipt)
    // ─────────────────────────────────────────────
    const amount = 1_000_000;

    await mintTo(
      provider.connection,
      victim,
      mint,
      victimAta.address,
      victim.publicKey,
      amount
    );

    const [victimProfilePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_profile"), victim.publicKey.toBuffer()],
      program.programId
    );

    // tx_count seed for deposit receipt = current tx_count (0 if new)
    let victimTxCount = 0;
    const vInfo = await provider.connection.getAccountInfo(victimProfilePda);
    if (vInfo) {
      const prof = await program.account.userProfile.fetch(victimProfilePda);
      victimTxCount = Number(prof.txCount ?? prof.tx_count ?? 0);
    }

    const vTxLe = Buffer.alloc(8);
    vTxLe.writeBigUInt64LE(BigInt(victimTxCount), 0);

    const [victimDepositReceiptPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), victim.publicKey.toBuffer(), vTxLe],
      program.programId
    );

    await program.methods
      .splDepositWithReceipt(new anchor.BN(amount))
      .accounts({
        user: victim.publicKey,
        userProfile: victimProfilePda,
        treasury: treasuryPda,
        mint,
        userAta: victimAta.address,
        treasuryAta: treasuryAta.address,
        receipt: victimDepositReceiptPda,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([victim])
      .rpc();

    // confirm treasury funded
    const tBefore = await getAccount(provider.connection, treasuryAta.address);
    if (Number(tBefore.amount) !== amount) {
      throw new Error("Treasury not funded as expected before attack.");
    }

    // ─────────────────────────────────────────────
    // 3) Attacker derives EXACT withdraw receipt PDA per Rust seeds
    //    seeds = [b"receipt", attacker, user_profile.tx_count]
    // ─────────────────────────────────────────────
    const [attackerProfilePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_profile"), attacker.publicKey.toBuffer()],
      program.programId
    );

    // If attacker profile doesn't exist yet, tx_count is effectively 0,
    // because the handler sets tx_count=0 when authority is default.
    let attackerTxCount = 0;
    const aInfo = await provider.connection.getAccountInfo(attackerProfilePda);
    if (aInfo) {
      const prof = await program.account.userProfile.fetch(attackerProfilePda);
      attackerTxCount = Number(prof.txCount ?? prof.tx_count ?? 0);
    }

    const aTxLe = Buffer.alloc(8);
    aTxLe.writeBigUInt64LE(BigInt(attackerTxCount), 0);

    const [attackerWithdrawReceiptPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), attacker.publicKey.toBuffer(), aTxLe],
      program.programId
    );

    // balances before attack
    const attackerBefore = await getAccount(provider.connection, attackerAta.address);
    const treasuryBefore = await getAccount(provider.connection, treasuryAta.address);

    // ─────────────────────────────────────────────
    // 4) Attack attempt
    // ─────────────────────────────────────────────
    let threw = false;
    let errMsg = "";

    try {
      const sig = await program.methods
        .splWithdrawWithReceipt(new anchor.BN(amount))
        .accounts({
          treasuryAuthority: attacker.publicKey,


          user: attacker.publicKey,
          userProfile: attackerProfilePda,
          treasury: treasuryPda,
          mint,
          userAta: attackerAta.address,
          treasuryAta: treasuryAta.address,
          receipt: attackerWithdrawReceiptPda,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([attacker])
        .rpc();

      console.log("⚠️ ATTACK TX (if this succeeded, it's a vulnerability):", sig);
    } catch (e: any) {
      if (!errMsg.includes("UnauthorizedWithdraw") && !errMsg.includes("Error Number: 6001")) {
    throw new Error("Attack failed, but not for UnauthorizedWithdraw/6001:\n" + errMsg);
  }

      threw = true;
      errMsg = e?.toString?.() ?? String(e);
      console.log("Attack failed (this is what we WANT if protected):", errMsg);
    }

    // ─────────────────────────────────────────────
    // 5) Post-conditions (always check)
    // ─────────────────────────────────────────────
    const attackerAfter = await getAccount(provider.connection, attackerAta.address);
    const treasuryAfter = await getAccount(provider.connection, treasuryAta.address);

    console.log("Attacker ATA before/after:", Number(attackerBefore.amount), Number(attackerAfter.amount));
    console.log("Treasury ATA before/after:", Number(treasuryBefore.amount), Number(treasuryAfter.amount));

    // If your protocol is meant to be protected, we EXPECT it to throw.
    // If it didn't throw, that's an immediate red-alert.
    if (!threw) {
      throw new Error(
        "CRITICAL: splWithdrawWithReceipt allowed an attacker to withdraw from treasury. " +
        "This instruction currently appears to have no authorization gate."
      );
    }

    // Also ensure balances did not move on failure
    if (Number(attackerAfter.amount) !== Number(attackerBefore.amount)) {
      throw new Error("attacker ATA changed despite failed attack (should be unchanged)");
    }
    if (Number(treasuryAfter.amount) !== Number(treasuryBefore.amount)) {
      throw new Error("treasury ATA changed despite failed attack (should be unchanged)");
    }

    // ensure no receipt was created on failure
    const r = await provider.connection.getAccountInfo(attackerWithdrawReceiptPda);
    if (r) {
      throw new Error("withdraw receipt was created despite failed attack (should not exist)");
    }

    // Optional: you can tighten expected error once we implement proper auth.
    // For now, we just require 'it throws' for protection.
  });
});


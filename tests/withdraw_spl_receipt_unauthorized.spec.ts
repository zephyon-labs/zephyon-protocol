import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
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

describe("protocol - spl withdraw with receipt unauthorized", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as Program<Protocol>;
  const payer = (provider.wallet as any).payer as anchor.web3.Keypair;

  async function airdrop(pk: PublicKey, sol = 2) {
    const sig = await provider.connection.requestAirdrop(
      pk,
      sol * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  }

  it("ATTACK: attacker tries to withdraw-with-receipt from treasury; should FAIL if protected", async () => {
    // --- Treasury PDA
    const [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );

    // --- Mint + ATAs (payer controls mint)
    const mint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6
    );

    const payerAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      payer.publicKey
    );

    const treasuryAtaAddr = getAssociatedTokenAddressSync(mint, treasuryPda, true);

    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      treasuryPda,
      true
    );

    // Seed payer funds then deposit to treasury
    const amount = 1_000_000;
    await mintTo(provider.connection, payer, mint, payerAta.address, payer, amount);

    await program.methods
      .splDeposit(new anchor.BN(amount))
      .accounts({
        user: payer.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: payerAta.address,
        treasuryAta: treasuryAtaAddr,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([payer])
      .rpc();

    // --- Attacker setup
    const attacker = Keypair.generate();
    await airdrop(attacker.publicKey, 2);

    const attackerAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      attacker,
      mint,
      attacker.publicKey
    );

    // userProfile PDA for attacker (required by withdraw_with_receipt)
    const [attackerUserProfilePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_profile"), attacker.publicKey.toBuffer()],
      program.programId
    );

    // receipt PDA for attacker (tx_count = 0 on first attempt)
    const txCount = new anchor.BN(0);
    const [attackReceiptPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), attacker.publicKey.toBuffer(), u64LE(txCount)],
      program.programId
    );

    const attackerBefore = await getAccount(provider.connection, attackerAta.address);
    const treasuryBefore = await getAccount(provider.connection, treasuryAtaAddr);

    // --- Attack: attacker tries to pretend they're the treasury authority
    try {
      await program.methods
        .splWithdrawWithReceipt(new anchor.BN(amount))
        .accounts({
          user: attacker.publicKey,
          treasuryAuthority: attacker.publicKey, // WRONG on purpose
          userProfile: attackerUserProfilePda,
          treasury: treasuryPda,
          mint,
          userAta: attackerAta.address,
          treasuryAta: treasuryAtaAddr,
          receipt: attackReceiptPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([attacker])
        .rpc();

      throw new Error("Attack unexpectedly succeeded (security failure).");
    } catch (e: any) {
      // We WANT failure.
      const msg = String(e?.message ?? e);
      console.log("Attack failed (this is what we WANT if protected):", msg);
    }

    const attackerAfter = await getAccount(provider.connection, attackerAta.address);
    const treasuryAfter = await getAccount(provider.connection, treasuryAtaAddr);

    console.log(
      "Attacker ATA before/after:",
      Number(attackerBefore.amount),
      Number(attackerAfter.amount)
    );
    console.log(
      "Treasury ATA before/after:",
      Number(treasuryBefore.amount),
      Number(treasuryAfter.amount)
    );
  });
});



import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

import type { Protocol } from "../target/idl/protocol";




describe("protocol - unauthorized withdraw", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as Program<Protocol>;

  function treasuryPda(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("treasury")], program.programId)[0];
  }

  async function ensureTreasuryInitialized(treas: PublicKey) {
    try {
      await program.methods
        .initializeTreasury()
        .accounts({
          authority: provider.wallet.publicKey,
          treasury: treas,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch {
      // already initialized is fine
    }
  }

  async function airdrop(pubkey: PublicKey, sol = 1) {
    const sig = await provider.connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, "confirmed");
  }

  it("rejects withdraw from non-treasury authority", async () => {
    const treas = treasuryPda();
    await ensureTreasuryInitialized(treas);

    const mint = await createMint(
      provider.connection,
      (provider.wallet as any).payer,
      provider.wallet.publicKey,
      null,
      6
    );

    // Provider ATA
    const userAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      mint,
      provider.wallet.publicKey
    );

    // Treasury ATA (owned by treasury PDA)
    const treasuryAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      mint,
      treas,
      true
    );

    const amount = 1_000_000;

    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      mint,
      userAta.address,
      provider.wallet.publicKey,
      amount
    );

    // Deposit into treasury
    await program.methods
      .splDeposit(new anchor.BN(amount))
      .accounts({
        user: provider.wallet.publicKey,
        treasury: treas,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // Attacker (not treasury authority)
    const attacker = Keypair.generate();
    await airdrop(attacker.publicKey, 1);

    const recipient = attacker.publicKey; // doesn't need to sign
    const recipientAta = await getAssociatedTokenAddress(mint, recipient);

    // Attempt unauthorized withdraw
    try {
      await program.methods
        .splWithdraw(new anchor.BN(amount))
        .accounts({
          treasuryAuthority: attacker.publicKey, // WRONG on purpose (must match treasury.authority)
          user: recipient,
          treasury: treas,
          mint,
          userAta: recipientAta,
          treasuryAta: treasuryAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([attacker])
        .rpc();

      throw new Error("Expected UnauthorizedWithdraw error, but tx succeeded");
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (!msg.includes("UnauthorizedWithdraw") && !msg.includes("Only the treasury authority may withdraw")) {
        throw new Error(`Expected UnauthorizedWithdraw, got: ${msg}`);
      }
    }

    // Confirm treasury still holds funds
    const tre = await getAccount(provider.connection, treasuryAta.address);
    if (Number(tre.amount) !== amount) {
      throw new Error(`Treasury balance changed unexpectedly. Expected ${amount}, got ${tre.amount}`);
    }
  });
});


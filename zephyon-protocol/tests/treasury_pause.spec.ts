import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

import { Protocol } from "../target/types/protocol";

import {
  initFoundationOnce,
  deriveTreasuryPda,
  loadProtocolAuthority,
  airdrop,
} from "./_helpers";

import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("protocol - treasury pause", () => {
  const userProvider = anchor.AnchorProvider.env();
  anchor.setProvider(userProvider);

  it("pauses deposits/withdraws and unpauses cleanly", async () => {
    const protocolAuth = loadProtocolAuthority();

    await airdrop(userProvider, protocolAuth.publicKey, 2);

    const authProvider = new anchor.AnchorProvider(
      userProvider.connection,
      new anchor.Wallet(protocolAuth),
      userProvider.opts
    );

    // Grab treasury PDA
    const [treasuryPda] = deriveTreasuryPda();

    // ─────────────────────────────────────────────────────────────
    // AUTH CONTEXT: init + pause/unpause must be done as authority
    // We swap the GLOBAL provider and re-grab workspace program.
    // ─────────────────────────────────────────────────────────────

    anchor.setProvider(authProvider);
    const programAuth = anchor.workspace.Protocol as Program<Protocol>;

    // IMPORTANT: init must run under authority context
    await initFoundationOnce(authProvider, programAuth as any, protocolAuth);


    // ───────────────── token setup (still fine under user provider) ─────────────────
    anchor.setProvider(userProvider);
    const programUser = anchor.workspace.Protocol as Program<Protocol>;

    const conn = userProvider.connection;
    const payer = (userProvider.wallet as any).payer;
    const user = userProvider.wallet.publicKey;

    const mint = await createMint(conn, payer, protocolAuth.publicKey, null, 6);

    const userAta = await getOrCreateAssociatedTokenAccount(conn, payer, mint, user);
    const treasuryAta = await getOrCreateAssociatedTokenAccount(
      conn,
      payer,
      mint,
      treasuryPda,
      true // <-- allowOwnerOffCurve
    );


    await mintTo(conn, payer, mint, userAta.address, protocolAuth, 1_000_000n);

    // baseline deposit (user)
    await programUser.methods
      .splDeposit(new BN(500_000))
      .accounts({
        user,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .rpc();

    // ───────────────── pause (authority) ─────────────────
    anchor.setProvider(authProvider);

    await programAuth.methods
      .setTreasuryPaused(true)
      .accounts({
        treasury: treasuryPda,
        treasuryAuthority: protocolAuth.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([protocolAuth])
      .rpc();

    // ───────────────── deposit must fail (user) ─────────────────
    anchor.setProvider(userProvider);

    try {
      await programUser.methods
        .splDeposit(new BN(1))
        .accounts({
          user,
          treasury: treasuryPda,
          mint,
          userAta: userAta.address,
          treasuryAta: treasuryAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      expect.fail("deposit should fail while paused");
    } catch (e: any) {
      expect(String(e).toLowerCase()).to.include("paused");
    }

    // ───────────────── withdraw must fail (paused) ─────────────────
    // Use authority signer so we hit paused (not unauthorized)
    anchor.setProvider(authProvider);

    try {
      await programAuth.methods
        .splWithdraw(new BN(1))
        .accounts({
          treasuryAuthority: protocolAuth.publicKey,
          user,
          treasury: treasuryPda,
          mint,
          userAta: userAta.address,
          treasuryAta: treasuryAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([protocolAuth])
        .rpc();

      expect.fail("withdraw should fail while paused");
    } catch (e: any) {
      expect(String(e).toLowerCase()).to.include("paused");
    }

    // ───────────────── unpause (authority) ─────────────────
    await programAuth.methods
      .setTreasuryPaused(false)
      .accounts({
        treasury: treasuryPda,
        treasuryAuthority: protocolAuth.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([protocolAuth])
      .rpc();

    // ───────────────── deposit works again (user) ─────────────────
    anchor.setProvider(userProvider);

    await programUser.methods
      .splDeposit(new BN(1))
      .accounts({
        user,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .rpc();
  });
});











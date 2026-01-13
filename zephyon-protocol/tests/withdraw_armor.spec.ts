import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";

import {
  createMint,
  getAccount,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  deriveTreasuryPda,
  loadProtocolAuthority,
  airdrop,
  initFoundationOnce,
} from "./_helpers";

describe("protocol - spl withdraw armor", () => {
  const userProvider = anchor.AnchorProvider.env();
  anchor.setProvider(userProvider);

  const programUser = anchor.workspace.Protocol as any;

  async function accountExists(
    conn: anchor.web3.Connection,
    pubkey: anchor.web3.PublicKey
  ) {
    const info = await conn.getAccountInfo(pubkey);
    return info !== null;
  }

  it("blocks splWithdraw while paused AND prevents user ATA creation", async () => {
    const conn = userProvider.connection;
    const payer = (userProvider.wallet as any).payer;

    // Authority identity (canonical)
    const protocolAuth = loadProtocolAuthority();
    await airdrop(userProvider, protocolAuth.publicKey, 2);

    const authProvider = new anchor.AnchorProvider(
      conn,
      new anchor.Wallet(protocolAuth),
      userProvider.opts
    );

    const [treasuryPda] = deriveTreasuryPda();

    // Ensure treasury exists + pause under authority context
    anchor.setProvider(authProvider);
    const programAuth = anchor.workspace.Protocol as any;

    // This keeps authority alignment consistent with your other tests
    await initFoundationOnce(authProvider, programAuth, protocolAuth);

    await programAuth.methods
      .setTreasuryPaused(true)
      .accounts({
        treasury: treasuryPda,
        treasuryAuthority: protocolAuth.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([protocolAuth])
      .rpc();

    // Switch back to user context for setup + withdraw attempt
    anchor.setProvider(userProvider);

    // Recipient does NOT need to sign (your Rust uses UncheckedAccount)
    const recipient = Keypair.generate();

    // Create a mint controlled by protocolAuth (clean + consistent)
    const mint = await createMint(conn, payer, protocolAuth.publicKey, null, 6);

    // Treasury ATA must exist, so we create it (owned by PDA)
    const treasuryAta = await getOrCreateAssociatedTokenAccount(
      conn,
      payer,
      mint,
      treasuryPda,
      true
    );

    // Fund the treasury with tokens (mint authority = protocolAuth)
    await mintTo(
      conn,
      payer,
      mint,
      treasuryAta.address,
      protocolAuth,
      1_000_000n
    );

    const treasuryBefore = await getAccount(conn, treasuryAta.address);

    // Derive recipient ATA but DO NOT create it
    const userAta = await getAssociatedTokenAddress(
      mint,
      recipient.publicKey,
      false
    );

    const existedBefore = await accountExists(conn, userAta);
    if (existedBefore) throw new Error("Recipient ATA unexpectedly existed");

    // Attempt withdraw while paused
    let failed = false;
    try {
      await programUser.methods
        .splWithdraw(new BN(1))
        .accounts({
          treasuryAuthority: protocolAuth.publicKey,
          user: recipient.publicKey,
          treasury: treasuryPda,
          mint,
          userAta,
          treasuryAta: treasuryAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([protocolAuth]) // authority pays for init_if_needed in withdraw
        .rpc();
    } catch {
      failed = true;
    }

    if (!failed) throw new Error("Withdraw unexpectedly succeeded while paused");

    // Assert: recipient ATA STILL not created (no side effects)
    const existedAfter = await accountExists(conn, userAta);
    if (existedAfter) {
      throw new Error(
        "Armor failure: recipient ATA was created even though protocol was paused"
      );
    }

    // Assert: treasury ATA balance unchanged
    const treasuryAfter = await getAccount(conn, treasuryAta.address);
    if (treasuryAfter.amount !== treasuryBefore.amount) {
      throw new Error("Armor failure: treasury balance changed while paused");
    }

    // Unpause (clean exit)
    anchor.setProvider(authProvider);
    await programAuth.methods
      .setTreasuryPaused(false)
      .accounts({
        treasury: treasuryPda,
        treasuryAuthority: protocolAuth.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([protocolAuth])
      .rpc();

    anchor.setProvider(userProvider);
  });
});

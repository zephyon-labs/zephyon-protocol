import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

// helpers (you already have these)
import {
  getProgram,
  initFoundationOnce,
  setupMintAndAtas,
  airdrop,
  deriveUserProfilePda,
  deriveWithdrawReceiptPda,
  PROGRAM_ID,
} from "./_helpers";


describe("protocol - armor (Core16)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let program: Program;
  let treasuryPda: anchor.web3.PublicKey;
  let protocolAuth: Keypair;

  before(async () => {
    program = getProgram();

    const foundation = await initFoundationOnce(
      provider as AnchorProvider,
      program
    );

    treasuryPda = foundation.treasuryPda;
    protocolAuth = foundation.protocolAuth;
  });

  it("A) splDeposit rejects fake treasury ATA (armor)", async () => {
    const user = Keypair.generate();
    await airdrop(provider, user.publicKey, 2);

    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      user,
      treasuryPda,
      1_000_000n
    );

    // WRONG treasury ATA: same mint, but ATA(owner != treasuryPda)
    const attacker = Keypair.generate();
    const fakeTreasuryAta = getAssociatedTokenAddressSync(
      mint,
      attacker.publicKey, // <-- wrong owner on purpose
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    let threw = false;
    try {
      await program.methods
        .splDeposit(new anchor.BN(1000))
        .accounts({
          user: user.publicKey,
          treasury: treasuryPda,
          mint,
          userAta: userAta.address,
          treasuryAta: fakeTreasuryAta, // <-- spoof attempt
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([user])
        .rpc();

      // If we got here, it DIDN'T reject. That's bad.
      threw = false;
    } catch {
      threw = true;
    }

    expect(threw).to.eq(true);
  });

  it("B) splDeposit rejects mismatched userAta (not ATA(owner=user,mint))", async () => {
    const user = Keypair.generate();
    await airdrop(provider, user.publicKey, 2);

    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      user,
      treasuryPda,
      1_000_000n
    );

    // WRONG user ATA: same mint, different owner
    const attacker = Keypair.generate();
    const wrongUserAta = getAssociatedTokenAddressSync(
      mint,
      attacker.publicKey, // <-- wrong owner on purpose
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    let threw = false;
    try {
      await program.methods
        .splDeposit(new anchor.BN(1000))
        .accounts({
          user: user.publicKey,
          treasury: treasuryPda,
          mint,
          userAta: wrongUserAta, // <-- spoof attempt
          treasuryAta: treasuryAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([user])
        .rpc();

      threw = false;
    } catch {
      threw = true;
    }

    expect(threw).to.eq(true);
  });

    it("C) splWithdraw rejects fake treasury ATA (armor)", async () => {
    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      protocolAuth,  // funder for minting/deposit setup; already has SOL
      treasuryPda,
      1_000_000n
    );

    // Ensure treasury has funds to withdraw
    await program.methods
      .splDeposit(new anchor.BN(1_000_000))
      .accounts({
        user: protocolAuth.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([protocolAuth])
      .rpc();

    // Recipient (doesn't need to sign for splWithdraw)
    const recipient = Keypair.generate();

    // Spoof treasury ATA: same mint, wrong owner
    const attacker = Keypair.generate();
    const fakeTreasuryAta = getAssociatedTokenAddressSync(
      mint,
      attacker.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    let threw = false;
    try {
      await program.methods
        .splWithdraw(new anchor.BN(1000))
        .accounts({
          treasuryAuthority: protocolAuth.publicKey,
          user: recipient.publicKey,
          treasury: treasuryPda,
          mint,
          userAta: getAssociatedTokenAddressSync(
            mint,
            recipient.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          ),
          treasuryAta: fakeTreasuryAta, // <-- spoof attempt
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([protocolAuth])
        .rpc();
    } catch {
      threw = true;
    }

    expect(threw).to.eq(true);
  });

  it("D) splWithdraw rejects mismatched userAta (not ATA(owner=user,mint))", async () => {
    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      protocolAuth,
      treasuryPda,
      1_000_000n
    );

    // Ensure treasury has funds
    await program.methods
      .splDeposit(new anchor.BN(1_000_000))
      .accounts({
        user: protocolAuth.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([protocolAuth])
      .rpc();

    const recipient = Keypair.generate();

    // WRONG user ATA: derived for attacker, not recipient
    const attacker = Keypair.generate();
    const wrongUserAta = getAssociatedTokenAddressSync(
      mint,
      attacker.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    let threw = false;
    try {
      await program.methods
        .splWithdraw(new anchor.BN(1000))
        .accounts({
          treasuryAuthority: protocolAuth.publicKey,
          user: recipient.publicKey,
          treasury: treasuryPda,
          mint,
          userAta: wrongUserAta, // <-- spoof attempt
          treasuryAta: treasuryAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([protocolAuth])
        .rpc();
    } catch {
      threw = true;
    }

    expect(threw).to.eq(true);
  });

    it("E) splWithdrawWithReceipt rejects fake treasury ATA (armor)", async () => {
    const user = Keypair.generate();
    await airdrop(provider, user.publicKey, 2);

    // Setup mint + ATAs, user starts with tokens
    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      user,
      treasuryPda,
      1_000_000n
    );

    // Fund the treasury so a withdraw-with-receipt would be possible
    await program.methods
      .splDeposit(new anchor.BN(1_000_000))
      .accounts({
        user: user.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([user])
      .rpc();

    // Correct PDAs for a fresh profile (tx_count starts at 0)
    const userProfilePda = deriveUserProfilePda(user.publicKey)[0];
    const correctReceiptPda = deriveWithdrawReceiptPda(
      PROGRAM_ID(),
      user.publicKey,
      0
    )[0];

    // Spoof treasury ATA: same mint, wrong owner
    const attacker = Keypair.generate();
    const fakeTreasuryAta = getAssociatedTokenAddressSync(
      mint,
      attacker.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    let threw = false;
    try {
      await program.methods
        .splWithdrawWithReceipt(new anchor.BN(1000))
        .accounts({
          user: user.publicKey,
          treasuryAuthority: protocolAuth.publicKey,
          userProfile: userProfilePda,
          treasury: treasuryPda,
          mint,
          userAta: userAta.address,
          treasuryAta: fakeTreasuryAta, // <-- spoof attempt
          receipt: correctReceiptPda,   // correct PDA, so failure is treasuryAta armor
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([user, protocolAuth])
        .rpc();
    } catch {
      threw = true;
    }

    expect(threw).to.eq(true);
  });

  it("F) splWithdrawWithReceipt rejects spoofed receipt PDA seed (txCountAfter)", async () => {
    const user = Keypair.generate();
    await airdrop(provider, user.publicKey, 2);

    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      user,
      treasuryPda,
      1_000_000n
    );

    // Fund treasury
    await program.methods
      .splDeposit(new anchor.BN(1_000_000))
      .accounts({
        user: user.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([user])
      .rpc();

    const userProfilePda = deriveUserProfilePda(user.publicKey)[0];

    // --- First withdraw-with-receipt to create profile + set tx_count to 1 ---
    const receipt0 = deriveWithdrawReceiptPda(PROGRAM_ID(), user.publicKey, 0)[0];

    await program.methods
      .splWithdrawWithReceipt(new anchor.BN(1))
      .accounts({
        user: user.publicKey,
        treasuryAuthority: protocolAuth.publicKey,
        userProfile: userProfilePda,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAta.address,
        receipt: receipt0,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([user, protocolAuth])
      .rpc();

    // Read tx_count AFTER first withdraw (should now be 1)
    const profile: any = await (program.account as any).userProfile.fetch(
      userProfilePda
    );
    const txCountBefore = Number(profile.txCount); // current value (pre-second-withdraw)
    // Program expects receipt seeded with txCountBefore.
    const correctReceipt = deriveWithdrawReceiptPda(
      PROGRAM_ID(),
      user.publicKey,
      txCountBefore
    )[0];

    // Attack: pass txCountAfter instead
    const wrongReceipt = deriveWithdrawReceiptPda(
      PROGRAM_ID(),
      user.publicKey,
      txCountBefore + 1
    )[0];

    let threw = false;
    try {
      await program.methods
        .splWithdrawWithReceipt(new anchor.BN(1))
        .accounts({
          user: user.publicKey,
          treasuryAuthority: protocolAuth.publicKey,
          userProfile: userProfilePda,
          treasury: treasuryPda,
          mint,
          userAta: userAta.address,
          treasuryAta: treasuryAta.address,
          receipt: wrongReceipt, // <-- spoof attempt (txCountAfter)
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([user, protocolAuth])
        .rpc();
    } catch {
      threw = true;
    }

    expect(threw).to.eq(true);

    // Optional sanity: if it DIDN'T throw, we also want to ensure it wasn't writing to correctReceipt.
    // (Not necessary if threw=true as expected.)
    expect(correctReceipt).to.not.eq(wrongReceipt);
  });

});



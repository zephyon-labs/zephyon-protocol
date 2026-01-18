import * as anchor from "@coral-xyz/anchor";
import { SystemProgram, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  expect,
  getProgram,
  initFoundationOnce,
  setupMintAndAtas,
  airdrop,
  loadProtocolAuthority,
  deriveDepositReceiptPda,
  deriveWithdrawReceiptPda,
  getAccountInfoOrNull,
} from "./_helpers";

describe("protocol - receipt invariants final (Core15.3)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program: any = getProgram();

  it("F1) deposit-with-receipt: nonce replay (same user+nonce) must fail", async () => {
    const user = anchor.web3.Keypair.generate();
    await airdrop(provider, user.publicKey, 2);

    const { treasuryPda } = await initFoundationOnce(provider, program);
    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      user,
      treasuryPda,
      1_000_000n
    );

    const amount = 1000;
    const nonce = 777;

    const [receiptPda] = deriveDepositReceiptPda(program.programId, user.publicKey, nonce);

    // first succeeds
    await program.methods
      .splDepositWithReceipt(new anchor.BN(amount), new anchor.BN(nonce))
      .accounts({
        user: user.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAta.address,
        receipt: receiptPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([user])
      .rpc();

    // second should fail (receipt PDA already exists)
    let threw = false;
    try {
      await program.methods
        .splDepositWithReceipt(new anchor.BN(amount), new anchor.BN(nonce))
        .accounts({
          user: user.publicKey,
          treasury: treasuryPda,
          mint,
          userAta: userAta.address,
          treasuryAta: treasuryAta.address,
          receipt: receiptPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([user])
        .rpc();
    } catch (_) {
      threw = true;
    }
    expect(threw).to.eq(true);
  });

  it("F2) deposit-with-receipt: different user cannot reuse someone else's receipt PDA", async () => {
    const userA = anchor.web3.Keypair.generate();
    const userB = anchor.web3.Keypair.generate();
    await airdrop(provider, userA.publicKey, 2);
    await airdrop(provider, userB.publicKey, 2);

    const { treasuryPda } = await initFoundationOnce(provider, program);

    const { mint: mintA, userAta: userAtaA, treasuryAta: treasuryAtaA } =
      await setupMintAndAtas(provider, userA, treasuryPda, 1_000_000n);

    const { userAta: userAtaB } =
      await setupMintAndAtas(provider, userB, treasuryPda, 1_000_000n);

    const amount = 500;
    const nonce = 888;

    const [receiptPdaA] = deriveDepositReceiptPda(program.programId, userA.publicKey, nonce);

    // userA creates their receipt
    await program.methods
      .splDepositWithReceipt(new anchor.BN(amount), new anchor.BN(nonce))
      .accounts({
        user: userA.publicKey,
        treasury: treasuryPda,
        mint: mintA,
        userAta: userAtaA.address,
        treasuryAta: treasuryAtaA.address,
        receipt: receiptPdaA,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([userA])
      .rpc();

    // userB tries to pass userA's receipt PDA (should fail)
    let threw = false;
    try {
      await program.methods
        .splDepositWithReceipt(new anchor.BN(amount), new anchor.BN(nonce))
        .accounts({
          user: userB.publicKey,
          treasury: treasuryPda,
          mint: mintA,
          userAta: userAtaB.address,
          treasuryAta: treasuryAtaA.address,
          receipt: receiptPdaA, // malicious reuse
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([userB])
        .rpc();
    } catch (_) {
      threw = true;
    }
    expect(threw).to.eq(true);
  });

  it("F3) withdraw-with-receipt: receipt must land at txCountBefore PDA, not txCountAfter", async () => {
    const user = anchor.web3.Keypair.generate();
    await airdrop(provider, user.publicKey, 2);

    const protocolAuth = loadProtocolAuthority();

    const { treasuryPda } = await initFoundationOnce(provider, program);
    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      user,
      treasuryPda,
      1_000_000n
    );

    // deposit first so treasury has tokens
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

    // user_profile PDA (your program seeds are [b"user_profile", user])
    const [userProfilePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_profile"), user.publicKey.toBuffer()],
      program.programId
    );

    // txCountBefore
    const profileBefore: any =
      await (program.account as any).userProfile.fetchNullable(userProfilePda);

    const txCountBefore = profileBefore ? Number(profileBefore.txCount) : 0;


    const [expectedReceiptPda] = deriveWithdrawReceiptPda(program.programId, user.publicKey, txCountBefore);
    const [phantomAfterPda] = deriveWithdrawReceiptPda(program.programId, user.publicKey, txCountBefore + 1);

    const withdrawAmount = 1000;

    await program.methods
      .splWithdrawWithReceipt(new anchor.BN(withdrawAmount))
      .accounts({
        user: user.publicKey,
        treasuryAuthority: protocolAuth.publicKey,
        userProfile: userProfilePda,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAta.address,
        receipt: expectedReceiptPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([user, protocolAuth])

      .rpc();

    // must exist at expected
    const existsExpected = await getAccountInfoOrNull(provider, expectedReceiptPda);
    expect(existsExpected).to.not.eq(null);

    // must NOT exist at after
    const existsAfter = await getAccountInfoOrNull(provider, phantomAfterPda);
    expect(existsAfter).to.eq(null);
  });
});

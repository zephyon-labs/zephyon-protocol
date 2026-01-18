import * as anchor from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  expect,
  getProgram,
  initFoundationOnce,
  setupMintAndAtas,
  deriveDepositReceiptPda,
  deriveWithdrawReceiptPda,
  deriveUserProfilePda,
} from "./_helpers";

describe("protocol - receipt PDA determinism (Core15.1)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program: any = getProgram();


  it("A) deposit-with-receipt: created receipt address matches derived PDA (user + nonce)", async () => {
    const payer = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(
      payer.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );

    const { treasuryPda } = await initFoundationOnce(provider, program);
    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      payer,
      treasuryPda,
      1_000_000n
    );

    const amount = 1234;
    const nonce = 777;

    const [expectedReceiptPda] = deriveDepositReceiptPda(
      program.programId,
      payer.publicKey,
      nonce
    );

    await program.methods
      .splDepositWithReceipt(new anchor.BN(amount), new anchor.BN(nonce))
      .accounts({
        user: payer.publicKey,
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
      .signers([payer])
      .rpc();

    const receipt = await (program.account as any).receipt.fetch(
      expectedReceiptPda
    );

    expect(receipt.user.equals(payer.publicKey)).to.eq(true);
    expect(receipt.mint.equals(mint)).to.eq(true);
    expect(Number(receipt.amount)).to.eq(amount);

    // You reuse tx_count as nonce for deposits
    expect(Number(receipt.txCount)).to.eq(nonce);
  });

  it("B) withdraw-with-receipt: created receipt address matches derived PDA (user + txCountBefore)", async () => {
    const payer = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(
      payer.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );

    const { treasuryPda, protocolAuth } = await initFoundationOnce(
      provider,
      program
    );
    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      payer,
      treasuryPda,
      1_000_000n
    );

    // Ensure treasury has funds to withdraw by depositing first
    await program.methods
      .splDeposit(new anchor.BN(1000))
      .accounts({
        user: payer.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([payer])
      .rpc();

    const [userProfilePda] = deriveUserProfilePda(payer.publicKey);

    // Seed uses PRE-INCREMENT tx_count snapshot
    let txCountBefore = 0;
    try {
      const up = await (program.account as any).userProfile.fetch(userProfilePda);
      txCountBefore = Number(up.txCount);
    } catch {
      txCountBefore = 0; // init_if_needed will set it to 0 on first withdraw
    }

    const [expectedReceiptPda] = deriveWithdrawReceiptPda(
      program.programId,
      payer.publicKey,
      txCountBefore
    );

    const amount = 500;

    await program.methods
      .splWithdrawWithReceipt(new anchor.BN(amount))
      .accounts({
        user: payer.publicKey,
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
      .signers([payer, protocolAuth])

      .rpc();

    const receipt = await (program.account as any).receipt.fetch(
      expectedReceiptPda
    );

    expect(receipt.user.equals(payer.publicKey)).to.eq(true);
    expect(receipt.mint.equals(mint)).to.eq(true);
    expect(Number(receipt.amount)).to.eq(amount);

    // Withdraw receipts store tx_count used for seed
    expect(Number(receipt.txCount)).to.eq(txCountBefore);
  });
});

import anchorPkg from "@coral-xyz/anchor";
const anchor = anchorPkg as typeof import("@coral-xyz/anchor");

import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";

import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";

describe("protocol - spl withdraw with receipt", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as any;

  it("withdraws SPL and writes a receipt", async () => {
    const user = Keypair.generate();

    // fund user
    const airdropSig = await provider.connection.requestAirdrop(
      user.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig, "confirmed");

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

    // mint
    const mint = await createMint(
      provider.connection,
      user,
      user.publicKey,
      null,
      6
    );

    const userAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      mint,
      user.publicKey
    );

    const treasuryAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      mint,
      treasuryPda,
      true
    );

    const amount = 1_000_000;
    await mintTo(
      provider.connection,
      user,
      mint,
      userAta.address,
      user.publicKey,
      amount
    );

    // user_profile pda
    const [userProfilePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_profile"), user.publicKey.toBuffer()],
      program.programId
    );

    // current tx_count (if profile doesn't exist => 0)
    const profileInfo = await provider.connection.getAccountInfo(userProfilePda);
    const txCount0 = profileInfo
      ? (await program.account.userProfile.fetch(userProfilePda)).txCount
      : 0;

    // ---------------------------
    // 1) Deposit first (to fund treasury)
    // ---------------------------

    // receipt pda for DEPOSIT at txCount0
    const txLe0 = Buffer.alloc(8);
    txLe0.writeBigUInt64LE(BigInt(txCount0), 0);

    const [depositReceiptPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), user.publicKey.toBuffer(), txLe0],
      program.programId
    );

    await program.methods
      .splDepositWithReceipt(new anchor.BN(amount))
      .accounts({
        user: user.publicKey,
        userProfile: userProfilePda,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAta.address,
        receipt: depositReceiptPda,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    // after deposit, userAta should be 0 and treasuryAta should be amount
    {
      const u1 = await getAccount(provider.connection, userAta.address);
      const t1 = await getAccount(provider.connection, treasuryAta.address);
      if (Number(u1.amount) !== 0) throw new Error("post-deposit: user ATA not drained");
      if (Number(t1.amount) !== amount) throw new Error("post-deposit: treasury ATA not credited");
    }

    // ---------------------------
    // 2) Withdraw with receipt
    // ---------------------------

    // withdraw receipt should use NEXT txCount (deposit incremented it)
    const txCount1 = (typeof txCount0 === "number") ? txCount0 + 1 : Number(txCount0) + 1;

    const txLe1 = Buffer.alloc(8);
    txLe1.writeBigUInt64LE(BigInt(txCount1), 0);

    const [withdrawReceiptPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), user.publicKey.toBuffer(), txLe1],
      program.programId
    );

    await program.methods
      .splWithdrawWithReceipt(new anchor.BN(amount))
      .accounts({
        treasuryAuthority: provider.wallet.publicKey,

        user: user.publicKey,
        userProfile: userProfilePda,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAta.address,
        receipt: withdrawReceiptPda,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    // assert withdraw receipt exists
    const r = await program.account.receipt.fetch(withdrawReceiptPda);

    if (r.amount.toNumber() !== amount) throw new Error("receipt amount mismatch");
    // withdraw direction should be 1 (deposit was 0)
    if (r.direction.toNumber ? r.direction.toNumber() !== 1 : r.direction !== 1) throw new Error("receipt direction mismatch");
    if (r.assetKind.toNumber ? r.assetKind.toNumber() !== 1 : r.assetKind !== 1) throw new Error("receipt assetKind mismatch");

    // balance check: user gets funds back, treasury drained
    const u = await getAccount(provider.connection, userAta.address);
    const t = await getAccount(provider.connection, treasuryAta.address);
    if (Number(u.amount) !== amount) throw new Error("user ATA not credited back");
    if (Number(t.amount) !== 0) throw new Error("treasury ATA not drained");
  });
});

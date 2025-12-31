import anchorPkg from "@coral-xyz/anchor";
const anchor = anchorPkg as typeof import("@coral-xyz/anchor");

import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";

import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";

describe("protocol - spl deposit with receipt", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as any;

  it("deposits SPL and writes a receipt", async () => {
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

    // tx_count: if profile doesn't exist => 0
    const profileInfo = await provider.connection.getAccountInfo(userProfilePda);
    const txCount = profileInfo ? (await program.account.userProfile.fetch(userProfilePda)).txCount : 0;

    // receipt pda for tx_count
    const txLe = Buffer.alloc(8);
    txLe.writeBigUInt64LE(BigInt(txCount), 0);

    const [receiptPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), user.publicKey.toBuffer(), txLe],
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
        receipt: receiptPda,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    // assert receipt exists
    const r = await program.account.receipt.fetch(receiptPda);

    if (r.amount.toNumber() !== amount) throw new Error("receipt amount mismatch");
    if (r.direction.toNumber ? r.direction.toNumber() !== 0 : r.direction !== 0) throw new Error("receipt direction mismatch");
    if (r.assetKind.toNumber ? r.assetKind.toNumber() !== 1 : r.assetKind !== 1) throw new Error("receipt assetKind mismatch");



    // balance check
    const u = await getAccount(provider.connection, userAta.address);
    const t = await getAccount(provider.connection, treasuryAta.address);
    if (Number(u.amount) !== 0) throw new Error("user ATA not drained");
    if (Number(t.amount) !== amount) throw new Error("treasury ATA not credited");
  });
});

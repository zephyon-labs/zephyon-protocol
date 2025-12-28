import anchorPkg from "@coral-xyz/anchor";
const anchor = anchorPkg as typeof import("@coral-xyz/anchor");

import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import BN from "bn.js";

import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("protocol - spl roundtrip", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as any;

  it("mints -> deposits -> withdraws back (round-trip)", async () => {
    // PDA
    const [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );

    // Ensure treasury exists
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

    // User
    const user = Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      user.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig, "confirmed");

    // Mint
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

    // Mint tokens to user
    const amount = 1_000_000;
    await mintTo(
      provider.connection,
      user,
      mint,
      userAta.address,
      user.publicKey,
      amount
    );

    const user0 = await getAccount(provider.connection, userAta.address);
    const tre0 = await getAccount(provider.connection, treasuryAta.address);

    // Deposit user -> treasury
    await program.methods
      .splDeposit(new BN(amount))
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
      })
      .signers([user])
      .rpc();

    const user1 = await getAccount(provider.connection, userAta.address);
    const tre1 = await getAccount(provider.connection, treasuryAta.address);

    // Withdraw treasury -> user
    await program.methods
      .splWithdraw(new BN(amount))
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
      })
      .signers([user])
      .rpc();

    const user2 = await getAccount(provider.connection, userAta.address);
    const tre2 = await getAccount(provider.connection, treasuryAta.address);

    // Assertions (simple, no chai needed)
    if (Number(user0.amount) !== amount) throw new Error("initial mint failed");
    if (Number(tre0.amount) !== 0) throw new Error("treasury not empty at start");

    if (Number(user1.amount) !== 0) throw new Error("deposit did not drain user");
    if (Number(tre1.amount) !== amount) throw new Error("deposit did not fill treasury");

    if (Number(user2.amount) !== amount) throw new Error("withdraw did not refill user");
    if (Number(tre2.amount) !== 0) throw new Error("withdraw did not drain treasury");
  });
});

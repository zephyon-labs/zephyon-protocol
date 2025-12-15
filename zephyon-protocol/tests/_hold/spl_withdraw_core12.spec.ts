import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
const { SystemProgram, Keypair } = anchor.web3;
import { expect } from "chai";
import type { Protocol } from "../target/types/protocol";

import {
  initFoundationOnce,
  deriveUserProfilePdaV3,
  deriveReceiptPdaByUserProfile,
  setupMintAndAtas,
} from "./_helpers";

describe("Core12 — SPL withdraw", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = (anchor.workspace as any).Protocol as Program<Protocol>;

  let protocolStatePda: anchor.web3.PublicKey;
  let treasuryPda: anchor.web3.PublicKey;
  const user = Keypair.generate();

  it("deposit SPL then withdraw SPL with receipts", async () => {
    ({ protocolStatePda, treasuryPda } =
      await initFoundationOnce(provider, program, provider.wallet.publicKey));

    const [userProfilePda] = deriveUserProfilePdaV3(
      program.programId,
      protocolStatePda,
      user.publicKey
    );

    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      user,
      treasuryPda
    );

    // Register (idempotent)
    try {
      await program.methods
        .registerUser()
        .accounts({
          protocolState: protocolStatePda,
          treasury: treasuryPda,
          userProfile: userProfilePda,
          authority: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
    } catch (_) {}

    // Deposit first
    const pre: any = await program.account.userProfile.fetch(userProfilePda);
    const [depositReceiptPda] = deriveReceiptPdaByUserProfile(
      program.programId,
      userProfilePda,
      pre.txCount
    );
    await program.methods
      .splDeposit(new anchor.BN(100_000))
      .accounts({
        protocolState: protocolStatePda,
        treasury: treasuryPda,
        userProfile: userProfilePda,
        user: user.publicKey,
        userToken: userAta.address,
        treasuryToken: treasuryAta.address,
        mint,
        tokenProgram: (await import("@solana/spl-token")).TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        receipt: depositReceiptPda,
      })
      .signers([user])
      .rpc();

    // Withdraw
    const mid: any = await program.account.userProfile.fetch(userProfilePda);
    const [withdrawReceiptPda] = deriveReceiptPdaByUserProfile(
      program.programId,
      userProfilePda,
      mid.txCount
    );
    await program.methods
      .splWithdraw(new anchor.BN(50_000))
      .accounts({
        protocolState: protocolStatePda,
        treasury: treasuryPda,
        userProfile: userProfilePda,
        user: user.publicKey,
        userToken: userAta.address,
        treasuryToken: treasuryAta.address,
        mint,
        tokenProgram: (await import("@solana/spl-token")).TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        receipt: withdrawReceiptPda,
      })
      .signers([user])
      .rpc();

    const post: any = await program.account.userProfile.fetch(userProfilePda);
    expect(Number(post.txCount)).to.equal(Number(mid.txCount) + 1);
  });
});






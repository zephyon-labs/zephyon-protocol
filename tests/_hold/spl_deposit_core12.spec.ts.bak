import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
const { SystemProgram, Keypair } = anchor.web3;
import { expect } from "chai";
import type { Protocol } from "../target/types/protocol";

import {
  initFoundationOnce,
  deriveProtocolStatePda,
  deriveTreasuryPda,
  deriveUserProfilePdaV3,
  deriveReceiptPdaByUserProfile,
  setupMintAndAtas,
  leU64,
} from "./_helpers";

describe("Core12 — SPL deposit", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = (anchor.workspace as any).Protocol as Program<Protocol>;

  let protocolStatePda: anchor.web3.PublicKey;
  let treasuryPda: anchor.web3.PublicKey;
  const user = Keypair.generate();

  it("init + user + deposit SPL with receipt", async () => {
    ({ protocolStatePda, treasuryPda } =
      await initFoundationOnce(provider, program, provider.wallet.publicKey));

    const [userProfilePda] = deriveUserProfilePdaV3(
      program.programId,
      protocolStatePda,
      user.publicKey
    );

    // Mint + ATAs
    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      user,
      treasuryPda
    );

    // Register
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

    const before: any = await program.account.userProfile.fetch(userProfilePda);
    const [receiptPda] = deriveReceiptPdaByUserProfile(program.programId, userProfilePda, before.txCount);

    // SPL deposit
    const amount = new anchor.BN(250_000); // depends on mint decimals (6)
    await program.methods
      .splDeposit(amount)
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
        receipt: receiptPda,
      })
      .signers([user])
      .rpc();

    const after: any = await program.account.userProfile.fetch(userProfilePda);
    expect(Number(after.txCount)).to.equal(Number(before.txCount) + 1);
  });
});






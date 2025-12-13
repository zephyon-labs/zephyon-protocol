import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
const { SystemProgram, LAMPORTS_PER_SOL, Keypair } = anchor.web3;
import { expect } from "chai";
import type { Protocol } from "../target/types/protocol";

import {
  deriveUserProfilePda,
  deriveProtocolStatePda,
  deriveTreasuryPda,
  airdrop,
} from "./_helpers";

describe("Core08 — register_user basics", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = (anchor.workspace as any).Protocol as Program<Protocol>;

  const user = Keypair.generate();
  let protocolStatePda: anchor.web3.PublicKey;
  let treasuryPda: anchor.web3.PublicKey;

  it("init + register", async () => {
    await airdrop(provider, provider.wallet.publicKey, 1 * LAMPORTS_PER_SOL);
    [protocolStatePda] = deriveProtocolStatePda();
    [treasuryPda] = deriveTreasuryPda();

    const [userProfilePda] = deriveUserProfilePda(user.publicKey);
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

    const up: any = await program.account.userProfile.fetch(userProfilePda);
    expect(up.authority.equals(user.publicKey)).to.be.true;
    expect(Number(up.txCount)).to.equal(0);
  });
});





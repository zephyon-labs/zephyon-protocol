import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Protocol } from "../target/types/protocol";

describe("register_user", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as Program<Protocol>;

  // Canonical PDAs for protocol_state and treasury (match lib.rs)
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("zephyon_treasury")],
    program.programId
  );
  const [protocolStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_state")],
    program.programId
  );

  // Helper: derive user_profile PDA with Option-A seeds
  function deriveUserProfilePda(protocolState: PublicKey, userPk: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_profile"),
        protocolState.toBuffer(),
        userPk.toBuffer(),
      ],
      program.programId
    );
  }

  // Fresh user wallet for this spec
  const user = anchor.web3.Keypair.generate();

  // Initialize treasury + protocol once (idempotent)
  async function initFoundationOnce() {
    try {
      await program.methods
        .initializeTreasury()
        .accounts({
          treasury: treasuryPda,
          authority: provider.wallet.publicKey, // must match PROTOCOL_AUTHORITY
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (_) {
      // already exists
    }

    try {
      await program.methods
        .initializeProtocol()
        .accounts({
          protocolState: protocolStatePda,
          authority: provider.wallet.publicKey,
          treasury: treasuryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (_) {
      // already exists
    }
  }

  it("creates a new UserProfile PDA for the user", async () => {
    // fund fresh user
    const sig = await provider.connection.requestAirdrop(
      user.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    // bring up foundation
    await initFoundationOnce();

    // derive profile PDA (Option A seeds)
    const [userProfilePda, bump] = deriveUserProfilePda(
      protocolStatePda,
      user.publicKey
    );

    // register user (authority=user)
    await program.methods
      .registerUser()
      .accounts({
        protocolState: protocolStatePda,
        treasury: treasuryPda,
        userProfile: userProfilePda,
        authority: user.publicKey, // <-- IMPORTANT name
        systemProgram: SystemProgram.programId,
      })
      .signers([user]) // <-- user must sign
      .rpc();

    // fetch + assert
    const up: any = await program.account.userProfile.fetch(userProfilePda);

    if (!up.authority.equals(user.publicKey)) throw new Error("authority mismatch");
    if (Number(up.joinedAt) === 0) throw new Error("joined_at not set");
    if (!up.txCount.eq(new anchor.BN(0))) throw new Error("tx_count != 0");
    if (!up.totalSent.eq(new anchor.BN(0))) throw new Error("total_sent != 0");
    if (!up.totalReceived.eq(new anchor.BN(0))) throw new Error("total_received != 0");
    if (up.riskScore !== 0) throw new Error("risk_score != 0");
    if (up.flags !== 0) throw new Error("flags != 0");
    if (up.bump !== bump) throw new Error("bump mismatch");
  });

  it("rejects double registration for the same user", async () => {
    const [userProfilePda] = deriveUserProfilePda(
      protocolStatePda,
      user.publicKey
    );

    let threw = false;
    try {
      await program.methods
        .registerUser()
        .accounts({
          userProfile: userProfilePda,
          protocolState: protocolStatePda,
          treasury: treasuryPda,
          authority: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
    } catch (err) {
      threw = true;
      console.log("Expected double registration error:", err);
    }
    if (!threw) throw new Error("Expected double registration to fail.");
  });
});



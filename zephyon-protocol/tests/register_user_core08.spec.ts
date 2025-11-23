import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Protocol } from "../target/types/protocol";

describe("register_user", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as Program<Protocol>;

  // We'll use a fresh wallet keypair to simulate a new user.
  const user = anchor.web3.Keypair.generate();

  // Canonical PDAs for protocol_state and treasury
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("zephyon_treasury")],
    program.programId
  );
  const [protocolStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_state")],
    program.programId
  );

  // Helper to initialize the foundation exactly once
  async function initFoundationOnce() {
    // Try initialize_treasury (will succeed first time, fail on duplicate)
    try {
      await program.methods
        .initializeTreasury()
        .accounts({
          treasury: treasuryPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        // Provider signs automatically
        .rpc();
    } catch (e) {
      // ignore "already in use"
    }

    // Try initialize_protocol (will succeed first time, fail on duplicate)
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
    } catch (e) {
      // ignore "already in use"
    }
  }

  it("creates a new UserProfile PDA for the user", async () => {
    // Fund the user wallet for rent
    const sig = await provider.connection.requestAirdrop(
      user.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    // Ensure protocol_state + treasury exist
    await initFoundationOnce();

    // Derive the UserProfile PDA using the same seeds as in lib.rs
    const [userProfilePda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_profile"), user.publicKey.toBuffer()],
      program.programId
    );

    // Call the register_user instruction (now requires protocol_state + treasury)
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

    // Fetch the on-chain UserProfile account
    const userProfile = await program.account.userProfile.fetch(userProfilePda);

    console.log("UserProfile:", userProfile);

    // Authority matches
    if (!userProfile.authority.equals(user.publicKey)) {
      throw new Error("authority mismatch on UserProfile");
    }

    // Joined_at is non-zero
    if (userProfile.joinedAt.toNumber() === 0) {
      throw new Error("joined_at was not set");
    }

    // Initial stats
    if (!userProfile.txCount.eq(new anchor.BN(0))) {
      throw new Error("tx_count should be 0 on init");
    }
    if (!userProfile.totalSent.eq(new anchor.BN(0))) {
      throw new Error("total_sent should be 0 on init");
    }
    if (!userProfile.totalReceived.eq(new anchor.BN(0))) {
      throw new Error("total_received should be 0 on init");
    }

    // Initial risk + flags + bump
    if (userProfile.riskScore !== 0) {
      throw new Error("risk_score should default to 0");
    }
    if (userProfile.flags !== 0) {
      throw new Error("flags should default to 0");
    }
    if (userProfile.bump !== bump) {
      throw new Error("bump doesn't match PDA bump");
    }
  });

  it("rejects double registration for the same user", async () => {
    // Use the same PDA and same user as in the first test.
    const [userProfilePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_profile"), user.publicKey.toBuffer()],
      program.programId
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

    if (!threw) {
      throw new Error("Expected double registration to fail, but it succeeded.");
    }
  });
});


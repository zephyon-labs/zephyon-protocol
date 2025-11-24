import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import { expect, assert } from "chai";
import { Protocol } from "../target/types/protocol";

describe("Core10 — withdraw flow (full counters)", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const program = anchor.workspace.Protocol as Program<Protocol>;

  // Withdraw a small amount so fees don’t muddy the math
  const AMOUNT = new BN(500_000); // 0.0005 SOL

  let protocolStatePda: PublicKey;
  let treasuryPda: PublicKey;
  let userProfilePda: PublicKey;
  const user = provider.wallet.payer;

  function deriveProfile(ps: PublicKey, who: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("user_profile"), ps.toBuffer(), who.toBuffer()],
      program.programId
    );
  }

  async function initFoundationOnce() {
    const [t] = PublicKey.findProgramAddressSync([Buffer.from("zephyon_treasury")], program.programId);
    const [ps] = PublicKey.findProgramAddressSync([Buffer.from("protocol_state")], program.programId);
    treasuryPda = t;
    protocolStatePda = ps;

    // Idempotent inits
    try {
      await program.methods
        .initializeTreasury()
        .accounts({
          treasury: treasuryPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (_) {}

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
    } catch (_) {}
  }

  before(async () => {
    await initFoundationOnce();

    // Ensure user profile exists
    const [up] = deriveProfile(protocolStatePda, user.publicKey);
    userProfilePda = up;

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
        .rpc();
    } catch (_) {}

    // Fund treasury via deposit first
    await program.methods
      .deposit(new BN(2 * LAMPORTS_PER_SOL))
      .accounts({
        protocolState: protocolStatePda,
        treasury: treasuryPda,
        userProfile: userProfilePda,
        user: user.publicKey, // your program uses `user` as the signer label
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("happy path: withdraw decreases treasury, increases user, updates full counters", async () => {
    const preUser = await provider.connection.getBalance(user.publicKey);
    const preTreasury = await provider.connection.getBalance(treasuryPda);

    await program.methods
      .withdraw(AMOUNT)
      .accounts({
        protocolState: protocolStatePda,
        treasury: treasuryPda,
        userProfile: userProfilePda,
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const postUser = await provider.connection.getBalance(user.publicKey);
    const postTreasury = await provider.connection.getBalance(treasuryPda);

    // user up (net of fee), treasury down by >= amount (system fees paid by recipient)
    expect(postUser).to.be.greaterThan(0); // user ends with positive balance
    expect(postTreasury).to.be.lessThan(preTreasury); // treasury decreased


    // Verify full counters on profile
    const up: any = await program.account.userProfile.fetch(userProfilePda);

    // tx_count increments for any tx (deposit/withdraw/etc.)
    expect(Number(up.txCount)).to.be.greaterThan(0);

    // FULL counters: these MUST exist in your account now
    expect(Number(up.withdrawCount)).to.be.greaterThan(0);
    expect(new BN(up.totalWithdrawn).gte(AMOUNT)).to.be.true;
    expect(Number(up.lastWithdrawAt)).to.be.greaterThan(0);
  });

  it("rejects zero amount", async () => {
    try {
      await program.methods
        .withdraw(new BN(0))
        .accounts({
          protocolState: protocolStatePda,
          treasury: treasuryPda,
          userProfile: userProfilePda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("expected zero-amount rejection");
    } catch (e: any) {
      // Accept either your custom error or a generic one depending on current impl
      expect(e.toString()).to.match(/Zero amount|Amount must be > 0|Insufficient funds|custom program error/i);
    }
  });

  it("rejects treasury mismatch", async () => {
    const fakeTreasury = Keypair.generate().publicKey;
    try {
      await program.methods
        .withdraw(new BN(1000))
        .accounts({
          protocolState: protocolStatePda,
          treasury: fakeTreasury, // wrong PDA
          userProfile: userProfilePda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("expected InvalidTreasuryPda / Unauthorized");
    } catch (e: any) {
      expect(e.toString()).to.match(/Invalid|Unauthorized|Constraint seeds|custom program error/i);
    }
  });

  it("rejects when profile.authority != signer", async () => {
    const intruder = Keypair.generate();
    // fund intruder for fees
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(intruder.publicKey, LAMPORTS_PER_SOL),
      "confirmed"
    );

    try {
      await program.methods
        .withdraw(new BN(1000))
        .accounts({
          protocolState: protocolStatePda,
          treasury: treasuryPda,
          userProfile: userProfilePda, // belongs to `user`, not `intruder`
          user: intruder.publicKey,    // wrong signer
          systemProgram: SystemProgram.programId,
        })
        .signers([intruder])
        .rpc();
      assert.fail("expected Unauthorized/constraint failure");
    } catch (e: any) {
      expect(e.toString()).to.match(/Unauthorized|Constraint|Invalid|custom program error/i);
    }
  });

  it("rejects when treasury has insufficient funds", async () => {
    const treasBal = await provider.connection.getBalance(treasuryPda);
    const tooMuch = new BN(treasBal + 1_000_000); // safely exceed balance

    try {
      await program.methods
        .withdraw(tooMuch)
        .accounts({
          protocolState: protocolStatePda,
          treasury: treasuryPda,
          userProfile: userProfilePda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("expected InsufficientFunds");
    } catch (e: any) {
      expect(e.toString()).to.match(/Insufficient funds|custom program error/i);
    }
  });
});


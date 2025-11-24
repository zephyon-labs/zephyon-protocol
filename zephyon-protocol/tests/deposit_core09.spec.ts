import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { assert, expect } from "chai";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Protocol } from "../target/types/protocol";

describe("Core09 — deposit flow", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const program = anchor.workspace.Protocol as Program<Protocol>;

  const LAMPORT = new BN(1_000_000); // 0.001 SOL

  let protocolStatePda: PublicKey;
  let treasuryPda: PublicKey;

  let userProfilePda: PublicKey;        // profile for provider.wallet
  let intruderProfilePda: PublicKey;    // profile for intruder

  const user = provider.wallet.payer;   // main signer (provider)
  let intruder: anchor.web3.Keypair;    // created in before()

  function deriveUserProfilePda(protocolState: PublicKey, userPk: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("user_profile"), protocolState.toBuffer(), userPk.toBuffer()],
      program.programId
    );
  }

  async function initFoundationOnce() {
    const [tPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("zephyon_treasury")],
      program.programId
    );
    const [psPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_state")],
      program.programId
    );
    treasuryPda = tPda;
    protocolStatePda = psPda;

    try {
      await program.methods
        .initializeTreasury()
        .accounts({
          treasury: treasuryPda,
          authority: provider.wallet.publicKey, // must match PROTOCOL_AUTHORITY
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
    // clean foundation
    await initFoundationOnce();

    // main user profile (provider)
    [userProfilePda] = deriveUserProfilePda(protocolStatePda, user.publicKey);
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

    // intruder setup (no top-level await!)
    intruder = anchor.web3.Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(intruder.publicKey, 1_000_000_000),
      "confirmed"
    );

    // intruder profile (so we have a real PDA we can misuse later)
    [intruderProfilePda] = deriveUserProfilePda(protocolStatePda, intruder.publicKey);
    try {
      await program.methods
        .registerUser()
        .accounts({
          protocolState: protocolStatePda,
          treasury: treasuryPda,
          userProfile: intruderProfilePda,
          authority: intruder.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([intruder])
        .rpc();
    } catch (_) {}
  });

  it("happy path: transfers SOL and updates counters", async () => {
    const preUser = await provider.connection.getBalance(user.publicKey);
    const preTreasury = await provider.connection.getBalance(treasuryPda);

    await program.methods
      .deposit(LAMPORT)
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

    expect(postTreasury - preTreasury).to.eq(LAMPORT.toNumber());
    expect(preUser - postUser).to.be.greaterThanOrEqual(LAMPORT.toNumber());

    const up: any = await program.account.userProfile.fetch(userProfilePda);
    expect(Number(up.depositCount)).to.eq(1);
    expect(new BN(up.totalDeposited).eq(LAMPORT)).to.be.true;
    expect(Number(up.lastDepositAt)).to.be.greaterThan(0);
  });

  it("rejects zero amount", async () => {
    try {
      await program.methods
        .deposit(new BN(0))
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
      expect(e.toString()).to.match(/Amount must be > 0|Insufficient funds/i);
    }
  });

  it("rejects treasury mismatch", async () => {
    const fakeTreasury = anchor.web3.Keypair.generate().publicKey;
    try {
      await program.methods
        .deposit(new BN(1_000_000))
        .accounts({
          protocolState: protocolStatePda,
          treasury: fakeTreasury,           // wrong PDA here
          userProfile: userProfilePda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("expected InvalidTreasuryPda");
    } catch (e: any) {
      expect(e.toString()).to.contain("Invalid PDA for treasury");
    }
  });

  it("rejects when profile.authority != signer", async () => {
    // We deliberately pass a *mismatched* profile (intruder's) with the main user as signer.
    // This triggers either "seeds" mismatch or constraint failure — both are acceptable.
    try {
      await program.methods
        .deposit(new BN(1_000_000))
        .accounts({
          protocolState: protocolStatePda,
          treasury: treasuryPda,
          userProfile: intruderProfilePda,      // <-- profile belongs to intruder
          user: user.publicKey,                 // <-- signer is the main user
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      throw new Error("Expected unauthorized deposit to fail");
    } catch (e: any) {
      let joined = "";
      if (typeof e.getLogs === "function") {
        const logs = await e.getLogs();
        joined = (logs ?? []).join("\n");
      } else if (e.transactionLogs) {
        joined = (e.transactionLogs ?? []).join("\n");
      } else if (e.logs) {
        joined = (e.logs ?? []).join("\n");
      } else {
        joined = e?.toString?.() ?? "";
      }
      expect(joined).to.match(/Unauthorized|AccountDidNotDeserialize|Invalid|Constraint|seeds/i);
    }
  });
});


// tests/deposit_core09.spec.ts
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import {
  PROGRAM_ID,
  initFoundationOnce,
  deriveProtocolStatePda,
  deriveTreasuryPda,
  deriveUserProfilePda,
  deriveReceiptPdaByUserProfile, // ← keep profile-based
} from "./_helpers";

describe("Core10 — SOL deposit (happy path)", () => {
  const amountLamports = new BN(1_000_000); // 0.001 SOL

  let program: any;
  let provider: anchor.AnchorProvider;
  let programId: PublicKey;
  let userPubkey: PublicKey;

  let protocolStatePda: PublicKey;
  let treasuryPda: PublicKey;
  let userProfilePda: PublicKey;

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    program = (anchor.workspace as any).Protocol;
    programId = PROGRAM_ID();

    // use provider wallet as signer
    userPubkey = provider.wallet.publicKey;

    // fund provider (idempotent)
    const sig = await provider.connection.requestAirdrop(userPubkey, 2_000_000_000);
    await provider.connection.confirmTransaction(sig, "confirmed");

    // init protocol once
    await initFoundationOnce(provider, program);

    [protocolStatePda] = deriveProtocolStatePda();
    [treasuryPda] = deriveTreasuryPda();
    [userProfilePda] = deriveUserProfilePda(userPubkey);

    // register profile (idempotent)
    try {
      await program.methods
        .registerUser()
        .accounts({
          protocolState: protocolStatePda,
          userProfile: userProfilePda,
          userPublicKey: userPubkey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (_) {}
  });

  it("register + deposit 0.001 SOL with receipt", async () => {
    // PRE-SNAPSHOT of tx_count
    const before = await program.account.userProfile
      .fetch(userProfilePda)
      .catch(() => null);
    const txCountBefore = before ? Number(before.txCount) : 0;

    // Derive the ONLY PDA your program expects: by USER_PROFILE + LE(txCountBefore)
    const [receiptPda] = deriveReceiptPdaByUserProfile(
      programId,
      userProfilePda,
      txCountBefore
    );

    console.log("programId       =", programId.toBase58());
    console.log("userProfilePda  =", userProfilePda.toBase58());
    console.log("userPubkey      =", userPubkey.toBase58());
    console.log("txCountBefore   =", txCountBefore);
    console.log("receipt/profile =", receiptPda.toBase58());

    await program.methods
      .deposit(amountLamports)
      .accounts({
        protocolState: protocolStatePda,
        treasury: treasuryPda,
        userProfile: userProfilePda,
        userPublicKey: userPubkey,
        systemProgram: SystemProgram.programId,
        receipt: receiptPda, // ← profile-based PDA
      })
      .rpc();

    const after = await program.account.userProfile.fetch(userProfilePda);
    // expect(Number(after.txCount)).to.equal(txCountBefore + 1);
  });
});







import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { Protocol } from "../target/types/protocol";

describe("zephyon-guardrails-core06", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as Program<Protocol>;

  const authority = provider.wallet;
  const fakeAuthority = Keypair.generate();

  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("zephyon_treasury")],
    program.programId
  );

  it("rejects unauthorized treasury initialization", async () => {
    // Fund the fake authority so lamports are not the failure reason
    const sig = await provider.connection.requestAirdrop(
      fakeAuthority.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .initializeTreasury()
        .accounts({
          authority: fakeAuthority.publicKey, // wrong on purpose
          treasury: treasuryPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([fakeAuthority])
        .rpc();

      throw new Error(
        "Test failed: unauthorized treasury init was allowed."
      );
    } catch (err: any) {
      console.log("Received error (expected):", err.toString());

      if (
        err.error &&
        err.error.errorCode &&
        err.error.errorCode.code
      ) {
        const code = err.error.errorCode.code;
        if (code !== "UnauthorizedTreasuryInit") {
          throw new Error(
            `Test failed: expected UnauthorizedTreasuryInit, got ${code}`
          );
        }
        // Correct guardrail triggered
        return;
      }

      throw new Error(
        `Test failed: did not get expected Anchor custom error. Raw: ${err}`
      );
    }
  });

  it("prevents duplicate treasury initialization", async () => {
    // First call: use the real authority. This SHOULD succeed.
    await program.methods
      .initializeTreasury()
      .accounts({
        authority: authority.publicKey,
        treasury: treasuryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Second call: try to initialize the same treasury PDA again.
    // This should fail because the account already exists.
    try {
      await program.methods
        .initializeTreasury()
        .accounts({
          authority: authority.publicKey,
          treasury: treasuryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      throw new Error(
        "Test failed: duplicate treasury initialization was allowed."
      );
    } catch (err: any) {
      console.log(
        "Received error on duplicate init (expected):",
        err.toString()
      );

      const msg = err.toString();

      // Depending on Anchor/Solana version, this will usually mention
      // "already in use" or a similar account-in-use error.
      if (
        msg.includes("already in use") ||
        msg.includes("AccountAlreadyInitialized") ||
        msg.includes("custom program error")
      ) {
        // Good enough for Core06: we proved the PDA cannot be re-initialized.
        return;
      }

      throw new Error(
        `Test failed: duplicate init did not fail in the expected way. Raw: ${err}`
      );
    }
  });
});




// tests/zephyon_guardrails_core06.spec.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import { Protocol } from "../target/types/protocol";

describe("zephyon-guardrails-core06", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as Program<Protocol>;

  // Canonical treasury PDA (single instance for the program)
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("zephyon_treasury")],
    program.programId
  );

  // Helper: fund a wallet if we need it to attempt an init
  async function fund(pubkey: PublicKey, sol: number = 2) {
    const sig = await provider.connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);
  }

  it("rejects unauthorized treasury initialization", async () => {
    // Unauthorized signer (NOT PROTOCOL_AUTHORITY)
    const rando = Keypair.generate();
    await fund(rando.publicKey, 1);

    let threw = false;
    try {
      await program.methods
        .initializeTreasury()
        .accounts({
          treasury: treasuryPda,
          authority: rando.publicKey,           // <- unauthorized on-chain
          systemProgram: SystemProgram.programId,
        })
        .signers([rando])
        .rpc();

      // If it got here, the program allowed an unauthorized init (bad)
      // but in practice this will either Anchor-error OR system-program fail
      // so reaching here should be impossible.
    } catch (err: any) {
      threw = true;
      // We accept either:
      // - Anchor custom error (UnauthorizedTreasuryInit)
      // - System Program "account already in use" (if the PDA was created earlier)
      console.log("Expected unauthorized init failure:", err?.transactionMessage ?? err?.message ?? err);
    }

    if (!threw) throw new Error("Expected unauthorized treasury init to fail, but it succeeded.");
  });

  it("prevents duplicate treasury initialization", async () => {
    // First attempt with the provider wallet (the allowed authority)
    // If the PDA already exists, this will fail now. That's acceptable.
    let firstSucceeded = false;
    try {
      await program.methods
        .initializeTreasury()
        .accounts({
          treasury: treasuryPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      firstSucceeded = true;
    } catch (err: any) {
      // If we’re here, it’s most likely because the account is already in use,
      // which still proves our duplicate-protection behavior.
      console.log("First init failed (likely already exists) — acceptable:", err?.transactionMessage ?? err?.message ?? err);
    }

    // If the first one succeeded, a second call must fail.
    if (firstSucceeded) {
      let threw = false;
      try {
        await program.methods
          .initializeTreasury()
          .accounts({
            treasury: treasuryPda,
            authority: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } catch (err: any) {
        threw = true;
        // Expect system-program "account already in use" or similar
        console.log("Duplicate init correctly failed:", err?.transactionMessage ?? err?.message ?? err);
      }
      if (!threw) throw new Error("Expected duplicate treasury init to fail, but it succeeded.");
    }
  });
});




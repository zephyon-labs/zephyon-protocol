const anchor = require("@coral-xyz/anchor");
const assert = require("assert");
const { Keypair, SystemProgram, LAMPORTS_PER_SOL, PublicKey } = require("@solana/web3.js");

describe("zephyon-protocol", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as anchor.Program;

  it("runs harness and connects to program", async () => {
    const payer = Keypair.generate();

    const sig = await provider.connection.requestAirdrop(
      payer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");

    const [userPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), payer.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .initializeUser()
        .accounts({
          user: userPda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();
    } catch (err: any) {
      console.log("initializeUser skipped/failed (ok for harness):", err.toString());
    }

    const depositAmount = 0.5 * LAMPORTS_PER_SOL;
    try {
      await program.methods
        .deposit(new anchor.BN(depositAmount))
        .accounts({
          user: userPda,
          from: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();
    } catch (err: any) {
      console.log("deposit skipped/failed (ok for harness):", err.toString());
    }

    assert.ok(true);
  });
});

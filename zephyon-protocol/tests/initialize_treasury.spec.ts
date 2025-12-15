import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import assert from "assert";

describe("protocol", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  // @ts-ignore
  const program = anchor.workspace.Protocol as Program;

  it("initializes treasury", async () => {
    const [treasuryPda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );

    await program.methods
      .initializeTreasury()
      .accounts({
        authority: provider.wallet.publicKey,
        treasury: treasuryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const acc: any = await program.account.treasury.fetch(treasuryPda);
    assert.strictEqual(
      acc.authority.toBase58(),
      provider.wallet.publicKey.toBase58()
    );
    assert.strictEqual(acc.bump, bump);
  });
});

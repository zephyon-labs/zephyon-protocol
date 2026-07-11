import * as anchor from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

import { deriveTreasuryPda } from "./_helpers";

describe("protocol", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = (anchor.workspace as any).Protocol;

  it("initializes treasury (idempotent)", async () => {
    const [treasuryPda] = deriveTreasuryPda();

    const existing = await provider.connection.getAccountInfo(treasuryPda);
    if (existing) {
      console.log("Treasury already exists:", treasuryPda.toBase58());
      return; // PASS
    }

    await program.methods
      .initializeTreasury()
      .accounts({
        treasury: treasuryPda,
        authority: provider.wallet.publicKey, // ✅ was payer
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const acct = await provider.connection.getAccountInfo(treasuryPda);
    expect(acct).to.not.be.null;
  });
});


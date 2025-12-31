import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
const { SystemProgram, LAMPORTS_PER_SOL, Keypair } = anchor.web3;
import { expect } from "chai";
import type { Protocol } from "../target/types/protocol";

import {
  deriveProtocolStatePda,
  deriveTreasuryPda,
  airdrop,
} from "./_helpers";

describe("Core06 — basic guardrails sanity", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = (anchor.workspace as any).Protocol as Program<Protocol>;

  it("anchor wiring + PDAs are derivable", async () => {
    await airdrop(provider, provider.wallet.publicKey, 1 * LAMPORTS_PER_SOL);
    const [protocolStatePda] = deriveProtocolStatePda();
    const [treasuryPda] = deriveTreasuryPda();

    expect(protocolStatePda).to.be.instanceOf(anchor.web3.PublicKey);
    expect(treasuryPda).to.be.instanceOf(anchor.web3.PublicKey);
    expect(program.programId).to.be.instanceOf(anchor.web3.PublicKey);
  });
});




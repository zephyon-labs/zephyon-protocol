import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";

// helpers (you already have these)
import {
  getProgram,
  initFoundationOnce,
  setupMintAndAtas,
  airdrop,
} from "./_helpers";

describe("protocol - armor (Core16)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let program: Program;
  let treasuryPda: anchor.web3.PublicKey;
  let protocolAuth: Keypair;

  before(async () => {
    program = getProgram();

    const foundation = await initFoundationOnce(
      provider as AnchorProvider,
      program
    );

    treasuryPda = foundation.treasuryPda;
    protocolAuth = foundation.protocolAuth;
  });

  it("A) splDeposit rejects fake treasury ATA (armor)", async () => {
    // placeholder – we will fill this in next
    expect(true).to.eq(true);
  });
});

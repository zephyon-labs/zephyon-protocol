import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { Protocol } from "../target/types/protocol";

import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import {
  getProgram,
  initFoundationOnce,
  setupMintAndAtas,
  airdrop,
} from "./_helpers";

describe("protocol - spl pay (Core17)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let program: anchor.Program<Protocol>;

  let treasuryPda: anchor.web3.PublicKey;
  let protocolAuth: Keypair;

  before(async () => {
    program = getProgram() as anchor.Program<Protocol>;

    const foundation = await initFoundationOnce(provider as AnchorProvider, program as any);

    treasuryPda = foundation.treasuryPda;
    protocolAuth = foundation.protocolAuth;
  });

  it("A) pays SPL from treasury to recipient and writes a receipt", async () => {
    // Setup: create mint + seed treasury with funds via deposit
    const funder = Keypair.generate();
    await airdrop(provider, funder.publicKey, 2);

    const { mint, userAta: funderAta, treasuryAta } = await setupMintAndAtas(
      provider,
      funder,
      treasuryPda,
      1_000_000n
    );

    await program.methods
      .splDeposit(new anchor.BN(1_000_000))
      .accounts({
        user: funder.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: funderAta.address,
        treasuryAta: treasuryAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([funder])
      .rpc();

    // Recipient
    const recipient = Keypair.generate();
    const recipientAta = getAssociatedTokenAddressSync(
      mint,
      recipient.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const DIR_PAY = 2; // if we standardize 0/1/2
    // Fetch treasury to get pay_count BEFORE the call
const treasuryAcc = await program.account.treasury.fetch(treasuryPda);
const payCountBefore = new anchor.BN(treasuryAcc.payCount);

const [receiptPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("receipt"),
    treasuryPda.toBuffer(),
    payCountBefore.toArrayLike(Buffer, "le", 8),
  ],
  program.programId
);

    


    // Execute pay (WILL FAIL until implemented)
    await program.methods
      .splPay(new anchor.BN(1234))
      .accounts({
        treasuryAuthority: protocolAuth.publicKey,
        recipient: recipient.publicKey,
        treasury: treasuryPda,
        mint,
        recipientAta,
        treasuryAta: treasuryAta.address,
        receipt: receiptPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([protocolAuth])
      .rpc();

    // Post-checks will be added once receipt is real
    expect(true).to.eq(true);
  });
});

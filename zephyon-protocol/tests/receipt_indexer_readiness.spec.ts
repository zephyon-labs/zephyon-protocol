import * as anchor from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  expect,
  getProgram,
  initFoundationOnce,
  setupMintAndAtas,
  deriveDepositReceiptPda,
  getAccountInfoOrNull,
  decodeReceiptFromAccountInfo,
  airdrop, // ✅ add this
} from "./_helpers";


describe("protocol - receipt indexer readiness (Core15.2)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program: any = getProgram();

  it("A) indexer-style: raw getAccountInfo + decode yields correct receipt fields", async () => {
    const payer = anchor.web3.Keypair.generate();
    await airdrop(provider, payer.publicKey, 2);


    const { treasuryPda } = await initFoundationOnce(provider, program);
    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      payer,
      treasuryPda,
      1_000_000n
    );

    const amount = 1234;
    const nonce = 999;

    const [receiptPda] = deriveDepositReceiptPda(program.programId, payer.publicKey, nonce);

    const sig = await program.methods
      .splDepositWithReceipt(new anchor.BN(amount), new anchor.BN(nonce))
      .accounts({
        user: payer.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAta.address,
        receipt: receiptPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([payer])
      .rpc();

    await provider.connection.confirmTransaction(sig, "confirmed");

    // Indexer-style: raw fetch
    const info = await getAccountInfoOrNull(provider, receiptPda);
    expect(info).to.not.eq(null);

    // Decode raw bytes
    const decoded = decodeReceiptFromAccountInfo(program, info!);

    expect(decoded.user.equals(payer.publicKey)).to.eq(true);
    expect(decoded.mint.equals(mint)).to.eq(true);
    expect(Number(decoded.amount)).to.eq(amount);
    expect(Number(decoded.txCount)).to.eq(nonce); // deposit stores nonce in tx_count
  });

  it("B) indexer-style: non-existent receipt PDA returns null", async () => {
    const user = anchor.web3.Keypair.generate();

    const [phantomReceiptPda] = deriveDepositReceiptPda(
      program.programId,
      user.publicKey,
      424242
    );

    const info = await getAccountInfoOrNull(provider, phantomReceiptPda);
    expect(info).to.eq(null);
  });
});

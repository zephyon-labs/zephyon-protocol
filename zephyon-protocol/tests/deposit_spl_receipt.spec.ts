import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

import { Protocol } from "../target/types/protocol";

function u64LE(n: anchor.BN): Buffer {
  return n.toArrayLike(Buffer, "le", 8);
}

// Derive deposit receipt PDA (deposit-with-receipt uses nonce-seeded receipt)
function depositReceiptPda(
  programId: PublicKey,
  user: PublicKey,
  nonce: anchor.BN
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), user.toBuffer(), u64LE(nonce)],
    programId
  );
  return pda;
}

// Nonce generator that avoids PDA collisions across repeated test runs
function makeUniqueNonce(): anchor.BN {
  // ms timestamp fits in u64 for a long time; wrap as BN
  return new anchor.BN(Date.now());
}

describe("protocol - spl deposit with receipt", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as Program<Protocol>;
  const payer = (provider.wallet as any).payer as anchor.web3.Keypair;

  it("deposits SPL and writes a receipt (nonce-seeded)", async () => {
    // --- Treasury PDA
    const [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );

    // --- Mint + ATAs
    const mint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6
    );

    const userAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      payer.publicKey
    );

    const treasuryAtaAddr = getAssociatedTokenAddressSync(mint, treasuryPda, true);

    // Ensure treasury ATA exists (keeps test deterministic)
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      treasuryPda,
      true
    );
    // --- Ensure treasury is initialized
try {
  await program.methods
  .initializeTreasury()
  .accounts({
    authority: payer.publicKey,
    treasury: treasuryPda,
    systemProgram: SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  } as any)
  .signers([payer])
  .rpc();

} catch (e) {
  // Treasury likely already exists — safe to ignore
}

    // --- Seed user funds
    const amount = 1_000_000;
    await mintTo(provider.connection, payer, mint, userAta.address, payer, amount);

    // --- Nonce + receipt PDA
    const nonce = makeUniqueNonce();
    const receiptPda = depositReceiptPda(program.programId, payer.publicKey, nonce);

    // --- Pre-balances
    const userBefore = await getAccount(provider.connection, userAta.address);
    const treasuryBefore = await getAccount(provider.connection, treasuryAtaAddr);

    // --- Deposit with receipt
    await program.methods
      .splDepositWithReceipt(new anchor.BN(amount), nonce)
      .accounts({
        user: payer.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAtaAddr,
        receipt: receiptPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([payer])
      .rpc();

    // --- Receipt exists + basic correctness
    const r: any = await (program.account as any).receipt.fetch(receiptPda);

    const rAmount = r.amount instanceof anchor.BN ? r.amount.toNumber() : Number(r.amount);
    if (rAmount !== amount) throw new Error("receipt amount mismatch");

    const dir = r.direction instanceof anchor.BN ? r.direction.toNumber() : Number(r.direction);
    // Deposit direction should be 0 in your earlier convention
    if (dir !== 0) throw new Error("receipt direction mismatch");

    // --- Balance check
    const userAfter = await getAccount(provider.connection, userAta.address);
    const treasuryAfter = await getAccount(provider.connection, treasuryAtaAddr);

    if (Number(userBefore.amount) - Number(userAfter.amount) !== amount) {
      throw new Error("user ATA did not decrease by expected amount");
    }
    if (Number(treasuryAfter.amount) - Number(treasuryBefore.amount) !== amount) {
      throw new Error("treasury ATA did not increase by expected amount");
    }
  });
});


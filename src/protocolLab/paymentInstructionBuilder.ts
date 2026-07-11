import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

export type PaymentInstructionBuildRequest = {
  program: any;
  programId: PublicKey;
  treasuryPda: PublicKey;
  treasuryAuthority: PublicKey;
  mint: PublicKey;
  recipient: PublicKey;
  amountRaw: number;
  payCountBefore: BN;
};

export type PaymentInstructionBuildResult = {
  treasuryAta: PublicKey;
  recipientAta: PublicKey;
  receiptPda: PublicKey;
  instruction: anchor.web3.TransactionInstruction;
};

export async function buildSplPayInstruction(
  request: PaymentInstructionBuildRequest
): Promise<PaymentInstructionBuildResult> {
  if (
    !Number.isFinite(request.amountRaw) ||
    request.amountRaw <= 0 ||
    !Number.isInteger(request.amountRaw)
  ) {
    throw new Error("Amount must be a positive raw integer.");
  }

  const treasuryAta = getAssociatedTokenAddressSync(
    request.mint,
    request.treasuryPda,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const recipientAta = getAssociatedTokenAddressSync(
    request.mint,
    request.recipient,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const [receiptPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("receipt"),
      request.treasuryPda.toBuffer(),
      request.payCountBefore.toArrayLike(Buffer, "le", 8),
    ],
    request.programId
  );

  const instruction = await request.program.methods
    .splPay(new BN(request.amountRaw), null, null)
    .accounts({
      treasuryAuthority: request.treasuryAuthority,
      treasury: request.treasuryPda,
      mint: request.mint,
      treasuryAta,
      recipient: request.recipient,
      recipientAta,
      receipt: receiptPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  return {
    treasuryAta,
    recipientAta,
    receiptPda,
    instruction,
  };
}
import { decodeTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";

type ExpectedDevnetTransferChecked = Readonly<{
  sourceTokenAccount: string;
  mint: string;
  destination: string;
  signerPublicKey: string;
  rawAmount: string;
  decimals: number;
  recentBlockhash: string;
}>;

/** Internal fail-closed validator for the sole economic transaction shape supported in v0.3.0. */
export function assertExactDevnetTransferChecked(bytes: Uint8Array, expected: ExpectedDevnetTransferChecked): void {
  let transaction: Transaction;
  try { transaction = Transaction.from(bytes); }
  catch { throw new Error("Devnet transferChecked validation requires a legacy Solana transaction."); }
  if (transaction.instructions.length !== 1) throw new Error("Devnet transaction must contain exactly one transferChecked instruction.");
  if (!transaction.feePayer?.equals(transaction.signatures[0]?.publicKey) || transaction.feePayer.toBase58() !== expected.signerPublicKey) throw new Error("Devnet fee payer and primary signer must match the declared signer.");
  if (transaction.recentBlockhash !== expected.recentBlockhash) throw new Error("Devnet transaction blockhash does not match prepared metadata.");
  let decoded;
  try { decoded = decodeTransferCheckedInstruction(transaction.instructions[0], TOKEN_PROGRAM_ID); }
  catch { throw new Error("Devnet transaction must use the SPL Token transferChecked instruction."); }
  if (decoded.keys.multiSigners.length !== 0 || !decoded.keys.owner.isSigner) throw new Error("Devnet transferChecked authority must be the direct required signer.");
  if (decoded.keys.source.pubkey.toBase58() !== expected.sourceTokenAccount) throw new Error("Devnet transferChecked source token account does not match prepared metadata.");
  if (decoded.keys.mint.pubkey.toBase58() !== expected.mint) throw new Error("Devnet transferChecked mint does not match prepared metadata.");
  const expectedDestinationTokenAccount = getAssociatedTokenAddressSync(new PublicKey(expected.mint), new PublicKey(expected.destination));
  if (!decoded.keys.destination.pubkey.equals(expectedDestinationTokenAccount)) throw new Error("Devnet transferChecked destination token account does not match the canonical wallet/mint ATA.");
  if (decoded.keys.owner.pubkey.toBase58() !== expected.signerPublicKey) throw new Error("Devnet transferChecked authority does not match the declared signer.");
  if (decoded.data.amount.toString() !== expected.rawAmount) throw new Error("Devnet transferChecked raw amount does not match prepared metadata.");
  if (decoded.data.decimals !== expected.decimals) throw new Error("Devnet transferChecked decimals do not match prepared metadata.");
}

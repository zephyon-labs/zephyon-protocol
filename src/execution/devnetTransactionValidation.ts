import { createHash } from "node:crypto";
import bs58 from "bs58";
import { Transaction, VersionedTransaction } from "@solana/web3.js";

export type InspectedSolanaTransaction = Readonly<{
  bytes: Uint8Array;
  signature: string;
  signerPublicKey: string;
  recentBlockhash: string;
  signedTransactionDigest: string;
}>;

export function decodeCanonicalBase64(value: string): Uint8Array {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Persisted Solana transaction must use non-empty canonical base64.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) throw new Error("Persisted Solana transaction must use non-empty canonical base64.");
  return Uint8Array.from(bytes);
}

export function inspectSignedSolanaTransaction(signedTransactionBase64: string): InspectedSolanaTransaction {
  const bytes = decodeCanonicalBase64(signedTransactionBase64);
  try {
    const transaction = Transaction.from(bytes);
    const first = transaction.signatures[0];
    if (!first?.signature) throw new Error("missing signature");
    if (!transaction.recentBlockhash) throw new Error("missing recent blockhash");
    return Object.freeze({ bytes, signature: bs58.encode(first.signature), signerPublicKey: first.publicKey.toBase58(), recentBlockhash: transaction.recentBlockhash, signedTransactionDigest: digestBytes(bytes) });
  } catch (legacyError) {
    try {
      const transaction = VersionedTransaction.deserialize(bytes);
      const first = transaction.signatures[0];
      const signer = transaction.message.staticAccountKeys[0];
      if (!first || first.every((byte) => byte === 0) || !signer) throw new Error("missing signature");
      return Object.freeze({ bytes, signature: bs58.encode(first), signerPublicKey: signer.toBase58(), recentBlockhash: transaction.message.recentBlockhash, signedTransactionDigest: digestBytes(bytes) });
    } catch {
      throw new Error(`Persisted Solana transaction is not parseable or signed (${legacyError instanceof Error ? legacyError.message : "invalid legacy transaction"}).`);
    }
  }
}

export function digestBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

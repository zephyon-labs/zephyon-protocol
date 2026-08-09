import { createHash } from "node:crypto";

export type DevnetSigningContext = Readonly<{
  cluster: "solana-devnet";
  executionId: string;
  policyHash: string;
}>;

export type DevnetSignedTransaction = Readonly<{
  signature: string;
  signedTransactionBase64: string;
}>;

/** Custody boundary. Implementations may use a KMS or managed secret service. */
export interface DevnetTransactionSigner {
  readonly keyId: string;
  readonly keyVersion: string;
  readonly publicKey: string;
  signTransaction(unsignedTransaction: Uint8Array, context: DevnetSigningContext): Promise<DevnetSignedTransaction>;
}

export function assertDevnetSignerIdentity(signer: DevnetTransactionSigner): void {
  if (!signer.keyId.trim() || !signer.keyVersion.trim() || !signer.publicKey.trim()) throw new Error("Devnet signer identity is incomplete.");
}

export function signedTransactionDigest(signedTransactionBase64: string): string {
  return createHash("sha256").update(Buffer.from(signedTransactionBase64, "base64")).digest("hex");
}

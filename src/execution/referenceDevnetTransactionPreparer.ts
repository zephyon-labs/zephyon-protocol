import { createTransferCheckedInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";
import type { RailExecutionCommand } from "./executionContext";
import type { SolanaDevnetPreparedTransaction, SolanaTransactionPreparer } from "./canonicalSolanaRpcTransport";
import { assertDevnetSignerIdentity, type DevnetTransactionSigner } from "./devnetSigner";
import { inspectSignedSolanaTransaction } from "./devnetTransactionValidation";

export type DevnetBlockhash = Readonly<{ recentBlockhash: string; lastValidBlockHeight: string }>;

export interface DevnetBlockhashSource {
  /** Infrastructure boundary. The reference composition itself never selects a network/provider. */
  getLatestDevnetBlockhash(): Promise<DevnetBlockhash>;
}

export type ReferenceDevnetPreparationPolicy = Readonly<{
  cluster: "solana-devnet";
  asset: string;
  mint: string;
  decimals: number;
  sourceTokenAccount: string;
  policyHash: string;
  submissionProviderId: string;
  reconciliationProviderId: string;
}>;

/**
 * Reference composition for an SPL transfer_checked transaction. Policy owns
 * mint/decimals/source/provider identities; the command owns destination/amount;
 * the signer owns key identity and custody.
 */
export class ReferenceSolanaDevnetTransactionPreparer implements SolanaTransactionPreparer {
  constructor(
    private readonly policy: ReferenceDevnetPreparationPolicy,
    private readonly blockhashSource: DevnetBlockhashSource,
    private readonly signer: DevnetTransactionSigner,
  ) {
    assertDevnetSignerIdentity(signer);
    if (policy.cluster !== "solana-devnet" || !policy.policyHash.trim() || !isTrimmedProviderId(policy.submissionProviderId) || !isTrimmedProviderId(policy.reconciliationProviderId)) throw new Error("Devnet preparation policy is incomplete.");
    if (policy.submissionProviderId === policy.reconciliationProviderId) throw new Error("Devnet submission and reconciliation providers must be independent.");
    if (!Number.isInteger(policy.decimals) || policy.decimals < 0 || policy.decimals > 255) throw new Error("Devnet mint decimals are invalid.");
    new PublicKey(policy.mint); new PublicKey(policy.sourceTokenAccount); new PublicKey(signer.publicKey);
  }

  async prepare(command: RailExecutionCommand): Promise<SolanaDevnetPreparedTransaction> {
    if (command.rail !== "solana" || command.destination.type !== "wallet" || command.destination.network !== "solana-devnet") throw new Error("Reference Devnet preparation requires a solana-devnet wallet command.");
    if (command.amount.asset !== this.policy.asset || command.amount.decimals !== this.policy.decimals) throw new Error("Command asset metadata does not match authoritative Devnet policy.");
    const amount = BigInt(command.amount.units);
    if (amount <= 0n) throw new Error("Devnet transfer amount must be positive.");
    const blockhash = await this.blockhashSource.getLatestDevnetBlockhash();
    if (!/^(0|[1-9]\d*)$/.test(blockhash.lastValidBlockHeight)) throw new Error("Devnet lastValidBlockHeight must be a canonical integer string.");
    const signerPublicKey = new PublicKey(this.signer.publicKey);
    const transaction = new Transaction({ feePayer: signerPublicKey, recentBlockhash: blockhash.recentBlockhash });
    transaction.add(createTransferCheckedInstruction(
      new PublicKey(this.policy.sourceTokenAccount),
      new PublicKey(this.policy.mint),
      new PublicKey(command.destination.address),
      signerPublicKey,
      amount,
      this.policy.decimals,
      [],
      TOKEN_PROGRAM_ID,
    ));
    const expectedMessage = transaction.serializeMessage();
    const unsignedBytes = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
    const signed = await this.signer.signTransaction(Uint8Array.from(unsignedBytes), Object.freeze({ cluster: "solana-devnet", executionId: command.executionId, policyHash: this.policy.policyHash }));
    const inspected = inspectSignedSolanaTransaction(signed.signedTransactionBase64);
    let signedMessage: Buffer;
    try { signedMessage = Transaction.from(Buffer.from(signed.signedTransactionBase64, "base64")).serializeMessage(); }
    catch { throw new Error("Reference Devnet signer must return the prepared legacy transaction."); }
    if (!signedMessage.equals(expectedMessage) || signed.signature !== inspected.signature || inspected.signerPublicKey !== this.signer.publicKey || inspected.recentBlockhash !== blockhash.recentBlockhash) throw new Error("Devnet signer returned transaction material inconsistent with the prepared transaction.");
    return Object.freeze({
      signature: inspected.signature,
      signedTransactionBase64: signed.signedTransactionBase64,
      signedTransactionDigest: inspected.signedTransactionDigest,
      cluster: "solana-devnet",
      mint: this.policy.mint,
      rawAmount: command.amount.units,
      destination: command.destination.address,
      sourceTokenAccount: this.policy.sourceTokenAccount,
      decimals: this.policy.decimals,
      recentBlockhash: blockhash.recentBlockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
      signerKeyId: this.signer.keyId,
      signerKeyVersion: this.signer.keyVersion,
      signerPublicKey: this.signer.publicKey,
      policyHash: this.policy.policyHash,
      submissionProviderId: this.policy.submissionProviderId,
      reconciliationProviderId: this.policy.reconciliationProviderId,
    });
  }
}

function isTrimmedProviderId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

import { RailProviderOperationError } from "./railAdapter";
import type { RailExecutionCommand } from "./executionContext";
import type { CanonicalSolanaPreparedSubmission, CanonicalSolanaRailTransport, SolanaChainObservation, SolanaPreparedTransaction, SolanaSubmissionResult } from "./canonicalSolanaRail";
import { assertCommittedDevnetSubmission } from "./devnetSubmissionContract";
import { inspectSignedSolanaTransaction } from "./devnetTransactionValidation";

export type SolanaRpcProviderRole = Readonly<{ providerId: string; network: "devnet"; role: "submission" | "reconciliation" }>;
export type SolanaRpcSubmitResponse = Readonly<{ signature: string; acceptedAt: string }>;

export interface SolanaSubmissionRpc {
  readonly identity: SolanaRpcProviderRole;
  submitExactSignedTransaction(bytes: Uint8Array): Promise<SolanaRpcSubmitResponse>;
}

export interface SolanaReconciliationRpc {
  readonly identity: SolanaRpcProviderRole;
  observeSignature(signature: string): Promise<SolanaChainObservation>;
}

export interface SolanaTransactionPreparer {
  prepare(command: RailExecutionCommand): Promise<SolanaDevnetPreparedTransaction>;
}

export type SolanaDevnetPreparedTransaction = SolanaPreparedTransaction & Readonly<{
  signature: string;
  signedTransactionBase64: string;
  signedTransactionDigest: string;
  cluster: "solana-devnet";
  mint: string;
  rawAmount: string;
  destination: string;
  decimals: number;
  recentBlockhash: string;
  lastValidBlockHeight: string;
  signerKeyId: string;
  signerKeyVersion: string;
  signerPublicKey: string;
  policyHash: string;
  submissionProviderId: string;
  reconciliationProviderId: string;
}>;

/**
 * Routes exact signed bytes to one submission provider and persisted signatures to
 * an independently configured reconciliation provider. It never owns a key or
 * creates economic policy.
 */
export class ProviderIndependentSolanaDevnetTransport implements CanonicalSolanaRailTransport {
  readonly cluster = "solana-devnet";
  constructor(
    private readonly preparer: SolanaTransactionPreparer,
    private readonly submission: SolanaSubmissionRpc,
    private readonly reconciliation: SolanaReconciliationRpc,
  ) {
    if (submission.identity.network !== "devnet" || submission.identity.role !== "submission") throw new Error("A Devnet submission provider is required.");
    if (reconciliation.identity.network !== "devnet" || reconciliation.identity.role !== "reconciliation") throw new Error("A Devnet reconciliation provider is required.");
    if (submission.identity.providerId === reconciliation.identity.providerId) throw new Error("Submission and reconciliation providers must be independent.");
  }

  async prepareTransaction(command: RailExecutionCommand): Promise<SolanaDevnetPreparedTransaction> {
    const prepared = await this.preparer.prepare(command);
    assertPreparedArtifact(prepared, command, this.submission.identity.providerId, this.reconciliation.identity.providerId);
    return Object.freeze({ ...prepared });
  }

  async submitTransaction(prepared: CanonicalSolanaPreparedSubmission): Promise<SolanaSubmissionResult> {
    try {
      assertCommittedDevnetSubmission(prepared);
    } catch (error) {
      throw new RailProviderOperationError(error instanceof Error ? error.message : "Devnet durable commitment is invalid.", "not_started");
    }
    let inspected;
    try {
      inspected = inspectSignedSolanaTransaction(prepared.payload.signedTransactionBase64);
      assertPayloadMatchesBytes(prepared, inspected, this.submission.identity.providerId, this.reconciliation.identity.providerId);
    } catch (error) {
      // The durable commitment is already reconciliation-only. Even though this
      // process has not contacted RPC, recovery must never submit this artifact.
      throw new RailProviderOperationError(error instanceof Error ? error.message : "Persisted Solana transaction is invalid.", "may_have_occurred");
    }
    try {
      // Crossing this call boundary makes provider contact ambiguous regardless of
      // how the provider implementation classifies a subsequent exception.
      const result = await this.submission.submitExactSignedTransaction(inspected.bytes);
      if (result.signature !== prepared.payload.signature) throw new RailProviderOperationError("Submission provider returned a different signature.", "may_have_occurred");
      return Object.freeze({ outcome: "accepted", submittedAt: result.acceptedAt, providerId: this.submission.identity.providerId });
    } catch (error) {
      throw new RailProviderOperationError(error instanceof Error ? error.message : "Solana submission response unavailable.", "may_have_occurred");
    }
  }

  async getSignatureObservation(signature: string): Promise<SolanaChainObservation> {
    const value = await this.reconciliation.observeSignature(signature);
    return Object.freeze({ ...value, providerId: this.reconciliation.identity.providerId });
  }
}

function assertPreparedArtifact(
  prepared: SolanaDevnetPreparedTransaction,
  command: RailExecutionCommand,
  submissionProviderId: string,
  reconciliationProviderId: string,
): void {
  if (command.rail !== "solana" || command.destination.type !== "wallet" || command.destination.network !== "solana-devnet") throw new Error("Devnet preparation requires a trusted solana-devnet command.");
  if (prepared.cluster !== "solana-devnet" || prepared.rawAmount !== command.amount.units || prepared.destination !== command.destination.address || prepared.decimals !== command.amount.decimals) throw new Error("Prepared Devnet artifact does not match the authoritative command.");
  if (prepared.submissionProviderId !== submissionProviderId || prepared.reconciliationProviderId !== reconciliationProviderId) throw new Error("Prepared Devnet artifact provider identities do not match configured policy.");
  if (!prepared.mint || !prepared.policyHash || !prepared.signerKeyId || !prepared.signerKeyVersion || !prepared.lastValidBlockHeight || !/^(0|[1-9]\d*)$/.test(prepared.lastValidBlockHeight)) throw new Error("Prepared Devnet artifact metadata is incomplete.");
  const inspected = inspectSignedSolanaTransaction(prepared.signedTransactionBase64);
  if (inspected.signature !== prepared.signature || inspected.signerPublicKey !== prepared.signerPublicKey || inspected.recentBlockhash !== prepared.recentBlockhash || inspected.signedTransactionDigest !== prepared.signedTransactionDigest) throw new Error("Prepared Devnet artifact does not match its exact signed transaction bytes.");
}

function assertPayloadMatchesBytes(
  prepared: CanonicalSolanaPreparedSubmission,
  inspected: ReturnType<typeof inspectSignedSolanaTransaction>,
  submissionProviderId: string,
  reconciliationProviderId: string,
): void {
  const payload = prepared.payload;
  if (payload.cluster !== "solana-devnet" || payload.signature !== inspected.signature || payload.signerPublicKey !== inspected.signerPublicKey || payload.recentBlockhash !== inspected.recentBlockhash || payload.signedTransactionDigest !== inspected.signedTransactionDigest) throw new Error("Persisted Devnet metadata does not match the exact signed transaction bytes.");
  if (!payload.mint || !payload.destination || !payload.rawAmount || payload.decimals === undefined || !payload.lastValidBlockHeight || !payload.signerKeyId || !payload.signerKeyVersion || !payload.policyHash) throw new Error("Persisted Devnet artifact metadata is incomplete.");
  if (payload.submissionProviderId !== submissionProviderId || payload.reconciliationProviderId !== reconciliationProviderId) throw new Error("Persisted Devnet provider identities do not match configured policy.");
}

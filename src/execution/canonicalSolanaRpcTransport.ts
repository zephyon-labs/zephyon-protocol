import { RailProviderOperationError } from "./railAdapter";
import type { RailExecutionCommand } from "./executionContext";
import type { CanonicalSolanaPreparedSubmission, CanonicalSolanaRailTransport, SolanaChainObservation, SolanaPreparedTransaction, SolanaSubmissionResult } from "./canonicalSolanaRail";

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
  prepare(command: RailExecutionCommand): Promise<SolanaPreparedTransaction>;
}

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

  prepareTransaction(command: RailExecutionCommand) { return this.preparer.prepare(command); }

  async submitTransaction(prepared: CanonicalSolanaPreparedSubmission): Promise<SolanaSubmissionResult> {
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(Buffer.from(prepared.payload.signedTransactionBase64, "base64")); }
    catch { throw new RailProviderOperationError("Persisted Solana transaction bytes are invalid.", "not_started"); }
    if (bytes.length === 0) throw new RailProviderOperationError("Persisted Solana transaction bytes are empty.", "not_started");
    try {
      const result = await this.submission.submitExactSignedTransaction(bytes);
      if (result.signature !== prepared.payload.signature) throw new RailProviderOperationError("Submission provider returned a different signature.", "may_have_occurred");
      return Object.freeze({ outcome: "accepted", submittedAt: result.acceptedAt, providerId: this.submission.identity.providerId });
    } catch (error) {
      if (error instanceof RailProviderOperationError) throw error;
      throw new RailProviderOperationError(error instanceof Error ? error.message : "Solana submission response unavailable.", "may_have_occurred");
    }
  }

  async getSignatureObservation(signature: string): Promise<SolanaChainObservation> {
    const value = await this.reconciliation.observeSignature(signature);
    return Object.freeze({ ...value, providerId: this.reconciliation.identity.providerId });
  }
}

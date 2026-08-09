import { createExecutionFailure } from "../resilience/executionRecovery";
import { createExactAmount, type ExactAmount } from "./exactValues";
import { createRailEvidence, type RailEvidence } from "./railEvidence";
import type { RailExecutionCommand } from "./executionContext";
import { parseProviderReference, parseReconciliationReference } from "./identifiers";
import { normalizeSubmissionException, type ReconciliationOutcome, type ReconciliationRequest, type SubmissionOutcome } from "./outcomes";
import {
  CANONICAL_RAIL_CONTRACT_VERSION,
  RailProviderOperationError,
  assertPreparedSubmissionMatchesOperation,
  type CanonicalPaymentRailAdapter,
  type PreparedSubmission,
  type RailOperationContext,
} from "./railAdapter";

export type SolanaPreparedTransaction = Readonly<{
  signature: string;
  signedTransactionBase64: string;
  cluster: string;
  mint: string;
  programId?: string;
  receiptPda?: string;
  recentBlockhash?: string;
  lastValidBlockHeight?: string;
  signerKeyId?: string;
  signerKeyVersion?: string;
  signerPublicKey?: string;
}>;

export type CanonicalSolanaPreparedSubmission = PreparedSubmission & Readonly<{
  rail: "solana";
  payload: Readonly<{
    signature: string;
    signedTransactionBase64: string;
    cluster: string;
    mint: string;
    rawAmount: string;
    destination: string;
    programId?: string;
    receiptPda?: string;
    recentBlockhash?: string;
    lastValidBlockHeight?: string;
    signerKeyId?: string;
    signerKeyVersion?: string;
    signerPublicKey?: string;
  }>;
}>;

export type SolanaSubmissionResult =
  | Readonly<{ outcome: "accepted"; submittedAt: string; providerId?: string }>
  | Readonly<{ outcome: "settled"; settledAt: string; slot: string; confirmationStatus: string; providerId?: string }>;

export type SolanaChainObservation =
  | Readonly<{ status: "missing"; observedAt: string; slot?: string; confirmationStatus?: string; providerId?: string }>
  | Readonly<{ status: "pending"; observedAt: string; slot?: string; confirmationStatus?: string; providerId?: string }>
  | Readonly<{ status: "settled"; observedAt: string; settledAt: string; slot: string; confirmationStatus: string; providerId?: string }>
  | Readonly<{ status: "failed"; observedAt: string; failedAt: string; slot?: string; errorCode: string; providerId?: string }>;

export type CanonicalSolanaRailTransport = Readonly<{
  cluster: string;
  /** Builds/signs deterministically but must not submit or expose private key material. */
  prepareTransaction(command: RailExecutionCommand): SolanaPreparedTransaction | Promise<SolanaPreparedTransaction>;
  submitTransaction(prepared: CanonicalSolanaPreparedSubmission): Promise<SolanaSubmissionResult>;
  getSignatureObservation(signature: string): Promise<SolanaChainObservation>;
  /** Optional provider preflight. Must return exact lamports and must not submit. */
  estimateFeeLamports?(command: RailExecutionCommand): string | Promise<string>;
}>;

export type SolanaRailEvidence = RailEvidence & Readonly<{ type: "solana.settlement"; version: 1 }>;

export class CanonicalSolanaPaymentRailAdapter implements CanonicalPaymentRailAdapter<CanonicalSolanaPreparedSubmission, SolanaRailEvidence> {
  readonly rail = "solana" as const;
  readonly contractVersion = CANONICAL_RAIL_CONTRACT_VERSION;
  constructor(private readonly transport: CanonicalSolanaRailTransport) {}

  async estimateFee(command: RailExecutionCommand): Promise<ExactAmount> {
    if (command.rail !== "solana") throw new Error("Solana fee estimation requires the Solana rail.");
    const units = this.transport.estimateFeeLamports ? await this.transport.estimateFeeLamports(command) : "0";
    return createExactAmount({ asset: "SOL", units, decimals: 9 });
  }

  async prepare(command: RailExecutionCommand): Promise<CanonicalSolanaPreparedSubmission> {
    if (command.rail !== "solana" || command.destination.type !== "wallet" || !command.destination.network.startsWith("solana")) throw new Error("Canonical Solana adapter requires a trusted Solana wallet destination.");
    const transaction = await this.transport.prepareTransaction(command);
    if (!transaction.signature || !transaction.signedTransactionBase64 || transaction.cluster !== command.destination.network) throw new Error("Solana preparation returned invalid or mismatched transaction material.");
    return Object.freeze({ schemaVersion: 1, contractVersion: this.contractVersion, rail: "solana", executionId: command.executionId, providerIdempotencyKey: command.providerIdempotencyKey, payload: Object.freeze({ ...transaction, rawAmount: command.amount.units, destination: command.destination.address }) });
  }

  async submit(prepared: CanonicalSolanaPreparedSubmission, context: RailOperationContext): Promise<SubmissionOutcome<SolanaRailEvidence>> {
    assertPreparedSubmissionMatchesOperation(prepared, context, this);
    const providerReference = parseProviderReference(prepared.payload.signature);
    const reconciliationReference = parseReconciliationReference(`solana:${prepared.payload.signature}`);
    try {
      const result = await this.transport.submitTransaction(prepared);
      if (result.outcome === "settled") return Object.freeze({ outcome: "settled", providerReference, reconciliationReference, settledAt: result.settledAt, evidence: evidence(prepared, { result: "settled", slot: result.slot, confirmationStatus: result.confirmationStatus, ...(result.providerId ? { submissionProviderId: result.providerId } : {}) }) });
      return Object.freeze({ outcome: "accepted", providerReference, reconciliationReference, submittedAt: result.submittedAt, evidence: evidence(prepared, { result: "accepted", ...(result.providerId ? { submissionProviderId: result.providerId } : {}) }) });
    } catch (error) {
      return normalizeSubmissionException({ error, providerContact: error instanceof RailProviderOperationError ? error.providerContact : "may_have_occurred", reconciliationReference, observedAt: context.invokedAt, correlationId: context.correlationId }) as SubmissionOutcome<SolanaRailEvidence>;
    }
  }

  async reconcile(request: ReconciliationRequest, context: RailOperationContext): Promise<ReconciliationOutcome<SolanaRailEvidence>> {
    const signature = request.providerReference ?? signatureFromReconciliation(request.reconciliationReference);
    let observation: SolanaChainObservation;
    try { observation = await this.transport.getSignatureObservation(signature); }
    catch (error) { return Object.freeze({ outcome: "unknown", observedAt: context.invokedAt, failure: createExecutionFailure({ code: "RECONCILIATION_FAILED", category: "reconciliation", stage: "reconciliation", phase: "reconciliation", sideEffect: "may_have_occurred", message: error instanceof Error ? error.message : "Solana status unavailable.", occurredAt: context.invokedAt, correlationId: context.correlationId }) }); }
    const base = { signature, cluster: this.transport.cluster, ...(observation.providerId ? { reconciliationProviderId: observation.providerId } : {}) } as const;
    if (observation.status === "missing") return Object.freeze({ outcome: "pending", observedAt: observation.observedAt, evidence: evidencePayload(base, { result: "missing", ...(observation.slot ? { slot: observation.slot } : {}), ...(observation.confirmationStatus ? { confirmationStatus: observation.confirmationStatus } : {}) }) });
    if (observation.status === "pending") return Object.freeze({ outcome: "pending", observedAt: observation.observedAt, evidence: evidencePayload(base, { result: "pending", ...(observation.slot ? { slot: observation.slot } : {}), ...(observation.confirmationStatus ? { confirmationStatus: observation.confirmationStatus } : {}) }) });
    if (observation.status === "settled") return Object.freeze({ outcome: "settled", providerReference: parseProviderReference(signature), settledAt: observation.settledAt, observedAt: observation.observedAt, evidence: evidencePayload(base, { result: "settled", slot: observation.slot, confirmationStatus: observation.confirmationStatus }) });
    return Object.freeze({ outcome: "failed", providerReference: parseProviderReference(signature), failedAt: observation.failedAt, observedAt: observation.observedAt, failure: createExecutionFailure({ code: "SETTLEMENT_FAILED", category: "settlement", stage: "reconciliation", phase: "reconciliation", sideEffect: "occurred", message: `Solana transaction authoritatively failed: ${observation.errorCode}.`, occurredAt: observation.observedAt, correlationId: context.correlationId }), evidence: evidencePayload(base, { result: "failed", errorCode: observation.errorCode, ...(observation.slot ? { slot: observation.slot } : {}) }) });
  }
}

function signatureFromReconciliation(reference: string): string {
  if (!reference.startsWith("solana:") || reference.length <= 7) throw new Error("Solana reconciliation requires a persisted transaction signature.");
  return reference.slice(7);
}
function evidence(prepared: CanonicalSolanaPreparedSubmission, result: Record<string, string>): SolanaRailEvidence { return evidencePayload(prepared.payload, result); }
function evidencePayload(payload: { signature: string; cluster: string; rawAmount?: string; destination?: string; mint?: string; programId?: string; receiptPda?: string; reconciliationProviderId?: string }, result: Record<string, string>): SolanaRailEvidence {
  return createRailEvidence({ type: "solana.settlement", version: 1, data: { cluster: payload.cluster, signature: payload.signature, ...(payload.rawAmount ? { rawAmount: payload.rawAmount } : {}), ...(payload.destination ? { destination: payload.destination } : {}), ...(payload.mint ? { mint: payload.mint } : {}), ...(payload.programId ? { programId: payload.programId } : {}), ...(payload.receiptPda ? { receiptPda: payload.receiptPda } : {}), ...(payload.reconciliationProviderId ? { reconciliationProviderId: payload.reconciliationProviderId } : {}), ...result } }) as SolanaRailEvidence;
}

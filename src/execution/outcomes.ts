import type { PaymentRail } from "../shared/paymentRail";
import type { ExecutionFailure } from "../resilience/executionRecovery";
import { createExecutionFailure } from "../resilience/executionRecovery";
import type { ExecutionId, ProviderIdempotencyKey, ProviderReference, ReconciliationReference } from "./identifiers";
import type { RailEvidence } from "./railEvidence";

export type SubmissionOutcome<E extends RailEvidence = RailEvidence> =
  | Readonly<{
      outcome: "rejected";
      submissionOccurred: false;
      failure: ExecutionFailure;
      evidence?: E;
    }>
  | Readonly<{
      outcome: "accepted";
      providerReference: ProviderReference;
      reconciliationReference: ReconciliationReference;
      submittedAt: string;
      evidence?: E;
    }>
  | Readonly<{
      outcome: "settled";
      providerReference: ProviderReference;
      reconciliationReference: ReconciliationReference;
      settledAt: string;
      evidence: E;
    }>
  | Readonly<{
      outcome: "unknown";
      submissionMayHaveOccurred: true;
      reconciliationReference: ReconciliationReference;
      observedAt: string;
      failure: ExecutionFailure;
      evidence?: E;
    }>;

export type ReconciliationRequest = Readonly<{
  schemaVersion: 1;
  executionId: ExecutionId;
  rail: PaymentRail;
  providerIdempotencyKey: ProviderIdempotencyKey;
  providerReference?: ProviderReference;
  reconciliationReference: ReconciliationReference;
}>;

export type ReconciliationOutcome<E extends RailEvidence = RailEvidence> =
  | Readonly<{ outcome: "pending"; observedAt: string; evidence?: E }>
  | Readonly<{
      outcome: "settled";
      providerReference: ProviderReference;
      settledAt: string;
      observedAt: string;
      evidence: E;
    }>
  | Readonly<{
      outcome: "failed";
      providerReference?: ProviderReference;
      failedAt: string;
      observedAt: string;
      failure: ExecutionFailure;
      evidence: E;
    }>
  | Readonly<{
      outcome: "unknown";
      observedAt: string;
      failure?: ExecutionFailure;
      evidence?: E;
    }>;

export type NormalizeSubmissionExceptionInput = Readonly<{
  error: unknown;
  providerContact: "not_started" | "may_have_occurred";
  reconciliationReference: ReconciliationReference;
  observedAt: string;
  correlationId?: string;
}>;

export function normalizeSubmissionException(
  input: NormalizeSubmissionExceptionInput,
): SubmissionOutcome {
  const mayHaveOccurred = input.providerContact === "may_have_occurred";
  const failure = createExecutionFailure({
    code: mayHaveOccurred ? "SUBMISSION_AMBIGUOUS" : "ADAPTER_FAILED",
    category: "adapter",
    stage: "submission",
    phase: mayHaveOccurred ? "submission" : "pre_submission",
    sideEffect: mayHaveOccurred ? "may_have_occurred" : "impossible",
    message: input.error instanceof Error ? input.error.message : "Unexpected adapter submission failure.",
    retryable: true,
    occurredAt: input.observedAt,
    correlationId: input.correlationId,
  });
  return mayHaveOccurred
    ? Object.freeze({
        outcome: "unknown",
        submissionMayHaveOccurred: true,
        reconciliationReference: input.reconciliationReference,
        observedAt: input.observedAt,
        failure,
      })
    : Object.freeze({ outcome: "rejected", submissionOccurred: false, failure });
}

import type { PaymentRail } from "../shared/paymentRail";
import type { ExecutionFailure } from "../resilience/executionRecovery";
import type { ExactAmount } from "./exactValues";
import type { RailExecutionCommand } from "./executionContext";
import type {
  AttemptId,
  CorrelationId,
  ExecutionId,
  ProviderIdempotencyKey,
  ProviderReference,
  ReconciliationReference,
  RuntimeRequestId,
} from "./identifiers";
import type { JsonObject } from "./json";
import type { ReconciliationOutcome, ReconciliationRequest, SubmissionOutcome } from "./outcomes";
import type { RailEvidence } from "./railEvidence";

export const CANONICAL_RAIL_CONTRACT_VERSION = 1 as const;
export type CanonicalRailContractVersion = typeof CANONICAL_RAIL_CONTRACT_VERSION;

export type PreparedSubmission = Readonly<{
  schemaVersion: 1;
  contractVersion: CanonicalRailContractVersion;
  rail: PaymentRail;
  executionId: ExecutionId;
  providerIdempotencyKey: ProviderIdempotencyKey;
  payload: JsonObject;
}>;

export type RailOperationContext = Readonly<{
  schemaVersion: 1;
  requestId: RuntimeRequestId;
  correlationId: CorrelationId;
  attemptId: AttemptId;
  executionId: ExecutionId;
  providerIdempotencyKey: ProviderIdempotencyKey;
  invokedAt: string;
}>;

export type CancellationRequest = Readonly<{
  schemaVersion: 1;
  executionId: ExecutionId;
  rail: PaymentRail;
  providerIdempotencyKey: ProviderIdempotencyKey;
  providerReference?: ProviderReference;
  reconciliationReference: ReconciliationReference;
}>;

export type CancellationOutcome<E extends RailEvidence = RailEvidence> =
  | Readonly<{ outcome: "cancelled"; cancelledAt: string; evidence: E }>
  | Readonly<{ outcome: "not_cancellable"; observedAt: string; failure?: ExecutionFailure; evidence?: E }>
  | Readonly<{ outcome: "unknown"; observedAt: string; failure: ExecutionFailure; evidence?: E }>;

export interface CanonicalPaymentRailAdapter<
  TPrepared extends PreparedSubmission = PreparedSubmission,
  TEvidence extends RailEvidence = RailEvidence,
> {
  readonly rail: PaymentRail;
  readonly contractVersion: CanonicalRailContractVersion;

  prepare(command: RailExecutionCommand): TPrepared | Promise<TPrepared>;

  submit(
    prepared: TPrepared,
    context: RailOperationContext,
  ): Promise<SubmissionOutcome<TEvidence>>;

  reconcile(
    request: ReconciliationRequest,
    context: RailOperationContext,
  ): Promise<ReconciliationOutcome<TEvidence>>;

  cancel?(
    request: CancellationRequest,
    context: RailOperationContext,
  ): Promise<CancellationOutcome<TEvidence>>;
}

export type CanonicalRailHealth = Readonly<{
  rail: PaymentRail;
  status: "available" | "degraded" | "unavailable";
  checkedAt: string;
  reasonCode?: string;
}>;

export interface RailHealthCapability {
  checkHealth(): Promise<CanonicalRailHealth>;
}

export interface RailFeeCapability {
  estimateFee(command: RailExecutionCommand): Promise<ExactAmount>;
}

/** Bounded adapter error carrying certainty about whether provider contact began. */
export class RailProviderOperationError extends Error {
  constructor(
    message: string,
    readonly providerContact: "not_started" | "may_have_occurred",
  ) {
    super(message);
    this.name = "RailProviderOperationError";
  }
}

export function assertPreparedSubmissionMatchesOperation(
  prepared: PreparedSubmission,
  context: RailOperationContext,
  adapter: Pick<CanonicalPaymentRailAdapter, "rail" | "contractVersion">,
): void {
  if (prepared.contractVersion !== CANONICAL_RAIL_CONTRACT_VERSION ||
      adapter.contractVersion !== CANONICAL_RAIL_CONTRACT_VERSION) {
    throw new Error("Canonical rail contract version mismatch.");
  }
  if (prepared.rail !== adapter.rail) throw new Error("Prepared submission rail mismatch.");
  if (prepared.executionId !== context.executionId) throw new Error("Prepared submission execution mismatch.");
  if (prepared.providerIdempotencyKey !== context.providerIdempotencyKey) {
    throw new Error("Provider idempotency key must remain stable.");
  }
}

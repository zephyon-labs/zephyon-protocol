import type { PaymentRail } from "../shared/paymentRail";
import type { RecoveryRecommendation } from "../resilience/executionRecovery";
import type { CanonicalExecutionContext } from "./executionContext";
import { parseCanonicalIdentifier, type CorrelationId, type ExecutionId } from "./identifiers";
import { copyJsonObject, type JsonObject } from "./json";
import { parseTimestamp } from "./executionContext";

export type RuntimeExecutionEventType =
  | "rail.selected" | "submission.prepared" | "submission.requested"
  | "submission.rejected" | "submission.accepted" | "submission.settled" | "submission.unknown"
  | "reconciliation.requested" | "reconciliation.pending" | "reconciliation.settled"
  | "reconciliation.failed" | "reconciliation.unknown" | "recovery.recommended" | "receipt.created";

export type RuntimeExecutionEvent = Readonly<{
  schemaVersion: 1;
  eventId: string;
  type: RuntimeExecutionEventType;
  occurredAt: string;
  executionId: ExecutionId;
  correlationId: CorrelationId;
  rail: PaymentRail;
  payload: JsonObject;
}>;

export type RuntimeEventDependencies = Readonly<{
  eventIdFactory: (type: RuntimeExecutionEventType, context: CanonicalExecutionContext) => string;
  clock: () => string;
}>;

export function createRuntimeExecutionEvent(
  type: RuntimeExecutionEventType,
  context: CanonicalExecutionContext,
  payload: JsonObject,
  dependencies: RuntimeEventDependencies,
): RuntimeExecutionEvent {
  return Object.freeze({
    schemaVersion: 1,
    eventId: parseCanonicalIdentifier(dependencies.eventIdFactory(type, context), "eventId"),
    type,
    occurredAt: parseTimestamp(dependencies.clock(), "runtimeEvent.occurredAt"),
    executionId: context.executionId,
    correlationId: context.correlationId,
    rail: context.selectedRail,
    payload: copyJsonObject(payload, "runtimeEvent.payload"),
  });
}

export function recoveryEventPayload(recommendation: RecoveryRecommendation): JsonObject {
  return {
    action: recommendation.action,
    retryable: recommendation.retryable,
    reasonCode: recommendation.reasonCode,
    ...(recommendation.earliestRetryDelayMs === undefined ? {} : { earliestRetryDelayMs: recommendation.earliestRetryDelayMs }),
  };
}

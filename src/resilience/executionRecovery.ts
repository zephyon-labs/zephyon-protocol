import { copyJsonObject, type JsonObject } from "../execution/json";
import {
  createRuntimeFailure,
  type RuntimeFailure,
  type RuntimeFailureCategory,
  type RuntimeFailureCode,
  type RuntimeFailureSeverity,
  type RuntimeFailureStage,
} from "./failure";
import { DEFAULT_RETRY_POLICY, evaluateRetry, type RetryPolicy } from "./retryPolicy";

export type ExecutionFailurePhase =
  | "runtime_validation"
  | "runtime_decision"
  | "pre_submission"
  | "submission"
  | "settlement"
  | "reconciliation"
  | "internal";

export type EconomicSideEffectPossibility =
  | "impossible"
  | "may_have_occurred"
  | "occurred";

export type ExecutionFailure = Readonly<
  Omit<RuntimeFailure, "cause" | "metadata"> & {
    phase: ExecutionFailurePhase;
    sideEffect: EconomicSideEffectPossibility;
    metadata: JsonObject;
  }
>;

export type CreateExecutionFailureInput = Readonly<{
  code: RuntimeFailureCode;
  category: RuntimeFailureCategory;
  stage: RuntimeFailureStage;
  phase: ExecutionFailurePhase;
  sideEffect: EconomicSideEffectPossibility;
  message: string;
  severity?: RuntimeFailureSeverity;
  retryable?: boolean;
  suggestedAction?: string;
  occurredAt?: string;
  correlationId?: string;
  metadata?: JsonObject;
}>;

export type RecoveryAction =
  | "retry_pre_submission"
  | "reconcile"
  | "wait_and_reconcile"
  | "manual_review"
  | "terminate";

export type RecoveryRecommendation = Readonly<{
  action: RecoveryAction;
  retryable: boolean;
  reasonCode: string;
  earliestRetryDelayMs?: number;
}>;

export type RecoveryRecommendationInput = Readonly<{
  failure: ExecutionFailure;
  attempt?: number;
  retryPolicy?: RetryPolicy;
}>;

export function createExecutionFailure(input: CreateExecutionFailureInput): ExecutionFailure {
  const base = createRuntimeFailure({
    code: input.code,
    category: input.category,
    stage: input.stage,
    message: input.message,
    severity: input.severity,
    retryable: input.sideEffect === "impossible" ? input.retryable : false,
    suggestedAction: input.suggestedAction,
    occurredAt: input.occurredAt,
    correlationId: input.correlationId,
  });
  return Object.freeze({
    code: base.code,
    category: base.category,
    stage: base.stage,
    message: base.message,
    severity: base.severity,
    retryable: base.retryable,
    suggestedAction: base.suggestedAction,
    occurredAt: base.occurredAt,
    correlationId: base.correlationId,
    phase: input.phase,
    sideEffect: input.sideEffect,
    metadata: copyJsonObject(input.metadata ?? {}, "executionFailure.metadata"),
  });
}

export function recommendRecovery(input: RecoveryRecommendationInput): RecoveryRecommendation {
  const { failure } = input;
  if (failure.sideEffect === "may_have_occurred") {
    if (failure.phase === "settlement" || failure.phase === "reconciliation") {
      return recommendation("wait_and_reconcile", true, "AMBIGUOUS_SETTLEMENT_REQUIRES_RECONCILIATION");
    }
    return recommendation("reconcile", true, "AMBIGUOUS_SUBMISSION_REQUIRES_RECONCILIATION");
  }
  if (failure.sideEffect === "occurred") {
    if (failure.phase === "settlement" || failure.phase === "reconciliation") {
      return recommendation("wait_and_reconcile", true, "SUBMITTED_PAYMENT_REQUIRES_RECONCILIATION");
    }
    return recommendation("reconcile", true, "SUBMITTED_PAYMENT_MUST_NOT_BE_RESUBMITTED");
  }
  if (failure.phase === "runtime_validation" || failure.phase === "runtime_decision" ||
      failure.code === "CONFIGURATION_ERROR" || failure.code === "PROVIDER_REJECTED_PRE_SUBMISSION") {
    return recommendation("terminate", false, "DETERMINISTIC_PRE_SUBMISSION_FAILURE");
  }
  const attempt = input.attempt ?? 1;
  const retry = evaluateRetry(failure, attempt, input.retryPolicy ?? DEFAULT_RETRY_POLICY);
  if (retry.shouldRetry) {
    return recommendation("retry_pre_submission", true, "SAFE_PRE_SUBMISSION_RETRY", retry.delayMs);
  }
  return recommendation(
    failure.retryable ? "manual_review" : "terminate",
    false,
    failure.retryable ? "PRE_SUBMISSION_RETRY_EXHAUSTED" : "NON_RETRYABLE_PRE_SUBMISSION_FAILURE",
  );
}

export function isSafeForAutomaticRetry(failure: ExecutionFailure): boolean {
  return failure.sideEffect === "impossible" &&
    failure.phase !== "runtime_validation" && failure.phase !== "runtime_decision" &&
    failure.code !== "CONFIGURATION_ERROR" && failure.retryable;
}

function recommendation(
  action: RecoveryAction,
  retryable: boolean,
  reasonCode: string,
  earliestRetryDelayMs?: number,
): RecoveryRecommendation {
  return Object.freeze({
    action,
    retryable,
    reasonCode,
    ...(earliestRetryDelayMs === undefined ? {} : { earliestRetryDelayMs }),
  });
}

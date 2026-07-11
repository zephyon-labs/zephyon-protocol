// src/resilience/failure.ts

import type { IsoTimestamp } from "../shared/time";

export type RuntimeFailureCategory =
  | "identity"
  | "compliance"
  | "risk"
  | "policy"
  | "trust"
  | "orchestration"
  | "adapter"
  | "rpc"
  | "network"
  | "settlement"
  | "receipt"
  | "timeout"
  | "validation"
  | "configuration"
  | "unknown";

export type RuntimeFailureSeverity =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type RuntimeFailureStage =
  | "runtime"
  | "identity"
  | "compliance"
  | "risk"
  | "policy"
  | "trust"
  | "orchestration"
  | "adapter"
  | "settlement"
  | "telemetry"
  | "receipt";

export type RuntimeFailureCode =
  | "IDENTITY_FAILED"
  | "COMPLIANCE_REJECTED"
  | "RISK_REJECTED"
  | "POLICY_REJECTED"
  | "TRUST_REJECTED"
  | "VALIDATION_FAILED"
  | "ADAPTER_FAILED"
  | "RPC_TIMEOUT"
  | "RPC_UNAVAILABLE"
  | "RPC_RATE_LIMITED"
  | "NETWORK_UNAVAILABLE"
  | "SETTLEMENT_FAILED"
  | "SETTLEMENT_TIMEOUT"
  | "RECEIPT_FAILED"
  | "CONFIGURATION_ERROR"
  | "UNKNOWN_RUNTIME_FAILURE";

export type RuntimeFailureInput = {
  code: RuntimeFailureCode;
  category: RuntimeFailureCategory;
  stage: RuntimeFailureStage;
  message: string;
  severity?: RuntimeFailureSeverity;
  retryable?: boolean;
  suggestedAction?: string;
  cause?: unknown;
  occurredAt?: IsoTimestamp;
  correlationId?: string;
  metadata?: Record<string, unknown>;
};

export type RuntimeFailure = {
  code: RuntimeFailureCode;
  category: RuntimeFailureCategory;
  stage: RuntimeFailureStage;
  message: string;
  severity: RuntimeFailureSeverity;
  retryable: boolean;
  suggestedAction?: string;
  cause?: unknown;
  occurredAt: IsoTimestamp;
  correlationId?: string;
  metadata: Record<string, unknown>;
};

export function createRuntimeFailure(input: RuntimeFailureInput): RuntimeFailure {
  return {
    code: input.code,
    category: input.category,
    stage: input.stage,
    message: input.message,
    severity: input.severity ?? inferFailureSeverity(input.code),
    retryable: input.retryable ?? inferRetryable(input.code),
    suggestedAction: input.suggestedAction,
    cause: input.cause,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    correlationId: input.correlationId,
    metadata: input.metadata ?? {},
  };
}

export function isRuntimeFailure(value: unknown): value is RuntimeFailure {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<RuntimeFailure>;

  return (
    typeof candidate.code === "string" &&
    typeof candidate.category === "string" &&
    typeof candidate.stage === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.retryable === "boolean"
  );
}

export function normalizeRuntimeFailure(
  error: unknown,
  fallback?: Partial<RuntimeFailureInput>,
): RuntimeFailure {
  if (isRuntimeFailure(error)) {
    return error;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown runtime failure";

  return createRuntimeFailure({
    code: fallback?.code ?? "UNKNOWN_RUNTIME_FAILURE",
    category: fallback?.category ?? "unknown",
    stage: fallback?.stage ?? "runtime",
    message: fallback?.message ?? message,
    severity: fallback?.severity,
    retryable: fallback?.retryable,
    suggestedAction: fallback?.suggestedAction,
    cause: error,
    occurredAt: fallback?.occurredAt,
    correlationId: fallback?.correlationId,
    metadata: fallback?.metadata,
  });
}

function inferRetryable(code: RuntimeFailureCode): boolean {
  switch (code) {
    case "RPC_TIMEOUT":
    case "RPC_UNAVAILABLE":
    case "RPC_RATE_LIMITED":
    case "NETWORK_UNAVAILABLE":
    case "SETTLEMENT_TIMEOUT":
      return true;

    case "COMPLIANCE_REJECTED":
    case "RISK_REJECTED":
    case "POLICY_REJECTED":
    case "TRUST_REJECTED":
    case "VALIDATION_FAILED":
    case "CONFIGURATION_ERROR":
      return false;

    default:
      return false;
  }
}

function inferFailureSeverity(code: RuntimeFailureCode): RuntimeFailureSeverity {
  switch (code) {
    case "COMPLIANCE_REJECTED":
    case "RISK_REJECTED":
    case "POLICY_REJECTED":
    case "TRUST_REJECTED":
      return "high";

    case "CONFIGURATION_ERROR":
    case "SETTLEMENT_FAILED":
      return "critical";

    case "RPC_TIMEOUT":
    case "RPC_UNAVAILABLE":
    case "RPC_RATE_LIMITED":
    case "NETWORK_UNAVAILABLE":
    case "SETTLEMENT_TIMEOUT":
      return "medium";

    default:
      return "medium";
  }
}
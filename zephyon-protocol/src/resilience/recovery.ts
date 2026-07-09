// src/resilience/recovery.ts

import type { RuntimeFailure } from "./failure";

export type RecoveryStrategy =
  | "none"
  | "retry"
  | "retry_with_backoff"
  | "rpc_failover"
  | "refresh_blockhash"
  | "increase_priority_fee"
  | "manual_review"
  | "terminate";

export type RecoveryDecision = {
  strategy: RecoveryStrategy;
  recoverable: boolean;
  reason: string;
  suggestedAction?: string;
};

export function evaluateRecovery(failure: RuntimeFailure): RecoveryDecision {
  switch (failure.code) {
    case "RPC_TIMEOUT":
    case "RPC_UNAVAILABLE":
      return {
        strategy: "rpc_failover",
        recoverable: true,
        reason: "RPC infrastructure failure can be retried against another endpoint.",
        suggestedAction: "Retry using an alternate RPC endpoint.",
      };

    case "RPC_RATE_LIMITED":
      return {
        strategy: "retry_with_backoff",
        recoverable: true,
        reason: "RPC provider rate limit may clear after a backoff delay.",
        suggestedAction: "Retry after exponential backoff.",
      };

    case "NETWORK_UNAVAILABLE":
      return {
        strategy: "retry_with_backoff",
        recoverable: true,
        reason: "Network availability may recover shortly.",
        suggestedAction: "Retry after backoff if connectivity returns.",
      };

    case "SETTLEMENT_TIMEOUT":
      return {
        strategy: "retry_with_backoff",
        recoverable: true,
        reason: "Settlement confirmation may be delayed or require another polling attempt.",
        suggestedAction: "Retry settlement confirmation before resubmitting payment.",
      };

    case "SETTLEMENT_FAILED":
      return {
        strategy: "manual_review",
        recoverable: false,
        reason: "Settlement failed after submission and may require manual inspection.",
        suggestedAction: "Inspect transaction state before retrying.",
      };

    case "CONFIGURATION_ERROR":
      return {
        strategy: "terminate",
        recoverable: false,
        reason: "Configuration errors are deterministic and should not be retried.",
        suggestedAction: "Fix runtime or adapter configuration.",
      };

    case "COMPLIANCE_REJECTED":
    case "RISK_REJECTED":
    case "POLICY_REJECTED":
    case "TRUST_REJECTED":
    case "VALIDATION_FAILED":
      return {
        strategy: "terminate",
        recoverable: false,
        reason: "Decision-stage rejection is terminal for this payment execution.",
        suggestedAction: failure.suggestedAction ?? "Do not retry this execution.",
      };

    case "ADAPTER_FAILED":
      return {
        strategy: failure.retryable ? "retry_with_backoff" : "manual_review",
        recoverable: failure.retryable,
        reason: failure.retryable
          ? "Adapter failure was marked retryable."
          : "Adapter failure was not marked retryable.",
        suggestedAction: failure.retryable
          ? "Retry adapter execution according to retry policy."
          : "Inspect adapter failure before retrying.",
      };

    case "RECEIPT_FAILED":
      return {
        strategy: "manual_review",
        recoverable: false,
        reason: "Payment may have succeeded while receipt creation failed.",
        suggestedAction: "Inspect settlement result before regenerating receipt.",
      };

    default:
      return {
        strategy: failure.retryable ? "retry" : "terminate",
        recoverable: failure.retryable,
        reason: failure.retryable
          ? "Failure was marked retryable."
          : "Failure was not marked retryable.",
        suggestedAction: failure.suggestedAction,
      };
  }
}
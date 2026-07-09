// src/resilience/retryPolicy.ts

import type { RuntimeFailure } from "./failure";

export type RetryStrategy =
  | "none"
  | "immediate"
  | "fixed"
  | "exponential";

export type RetryPolicy = {
  maxAttempts: number;
  strategy: RetryStrategy;
  baseDelayMs: number;
  maxDelayMs: number;
};

export type RetryDecision = {
  shouldRetry: boolean;
  nextAttempt: number;
  delayMs: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  strategy: "exponential",
  baseDelayMs: 500,
  maxDelayMs: 5_000,
};

export function evaluateRetry(
  failure: RuntimeFailure,
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): RetryDecision {
  if (!failure.retryable) {
    return {
      shouldRetry: false,
      nextAttempt: attempt,
      delayMs: 0,
    };
  }

  if (attempt >= policy.maxAttempts) {
    return {
      shouldRetry: false,
      nextAttempt: attempt,
      delayMs: 0,
    };
  }

  return {
    shouldRetry: true,
    nextAttempt: attempt + 1,
    delayMs: calculateRetryDelay(attempt, policy),
  };
}

export function calculateRetryDelay(
  attempt: number,
  policy: RetryPolicy,
): number {
  switch (policy.strategy) {
    case "none":
      return 0;

    case "immediate":
      return 0;

    case "fixed":
      return policy.baseDelayMs;

    case "exponential": {
      const delay =
        policy.baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));

      return Math.min(delay, policy.maxDelayMs);
    }

    default:
      return policy.baseDelayMs;
  }
}
// src/resilience/resilienceEngine.ts

import {
  createRuntimeFailure,
  normalizeRuntimeFailure,
  type RuntimeFailure,
  type RuntimeFailureInput,
  type RuntimeFailureStage,
} from "./failure";
import { evaluateRecovery, type RecoveryDecision } from "./recovery";
import {
  evaluateRetry,
  type RetryDecision,
  type RetryPolicy,
} from "./retryPolicy";
import { ResilienceContext } from "./resilienceContext";
import {
  createTimeoutDecision,
  withTimeout,
  type TimeoutPolicyMap,
} from "./timeoutPolicy";

export type ResilienceEngineOptions = {
  retryPolicy?: RetryPolicy;
  timeoutPolicy?: TimeoutPolicyMap;
  metadata?: Record<string, unknown>;
};

export type ResilienceExecutionInput<T> = {
  correlationId: string;
  stage: RuntimeFailureStage;
  operation: () => Promise<T>;
  failureFallback?: Partial<RuntimeFailureInput>;
};

export type ResilienceExecutionSuccess<T> = {
  ok: true;
  value: T;
  context: ReturnType<ResilienceContext["snapshot"]>;
};

export type ResilienceExecutionFailure = {
  ok: false;
  failure: RuntimeFailure;
  recoveryDecision: RecoveryDecision;
  retryDecision: RetryDecision;
  context: ReturnType<ResilienceContext["snapshot"]>;
};

export type ResilienceExecutionResult<T> =
  | ResilienceExecutionSuccess<T>
  | ResilienceExecutionFailure;

export class ResilienceEngine {
  constructor(private readonly options: ResilienceEngineOptions = {}) {}

  async execute<T>(
    input: ResilienceExecutionInput<T>,
  ): Promise<ResilienceExecutionResult<T>> {
    const context = new ResilienceContext({
      correlationId: input.correlationId,
      retryPolicy: this.options.retryPolicy,
      metadata: this.options.metadata,
    });

    while (true) {
      context.startAttempt();

      try {
        const timeoutDecision = createTimeoutDecision(
          input.stage,
          this.options.timeoutPolicy,
        );

        const value = await withTimeout(input.operation(), timeoutDecision);

        context.completeAttempt();

        return {
          ok: true,
          value,
          context: context.snapshot(),
        };
      } catch (error) {
        const failure = this.normalizeFailure(error, input);

        const recoveryDecision = evaluateRecovery(failure);

        const retryDecision = evaluateRetry(
          failure,
          context.getAttemptNumber(),
          context.getRetryPolicy(),
        );

        context.recordFailure(failure, recoveryDecision, retryDecision);
        context.completeAttempt();

        if (!recoveryDecision.recoverable || !retryDecision.shouldRetry) {
          return {
            ok: false,
            failure,
            recoveryDecision,
            retryDecision,
            context: context.snapshot(),
          };
        }

        await sleep(retryDecision.delayMs);
      }
    }
  }

  createFailure(input: RuntimeFailureInput): RuntimeFailure {
    return createRuntimeFailure(input);
  }

  private normalizeFailure<T>(
    error: unknown,
    input: ResilienceExecutionInput<T>,
  ): RuntimeFailure {
    if (isTimeoutError(error)) {
      return normalizeRuntimeFailure(error, {
        code: input.failureFallback?.code ?? "SETTLEMENT_TIMEOUT",
        category: input.failureFallback?.category ?? "timeout",
        stage: input.failureFallback?.stage ?? input.stage,
        severity: input.failureFallback?.severity ?? "medium",
        retryable: input.failureFallback?.retryable ?? true,
        suggestedAction:
          input.failureFallback?.suggestedAction ??
          "Retry according to timeout recovery policy.",
        correlationId: input.correlationId,
        metadata: input.failureFallback?.metadata ?? {},
      });
    }

    return normalizeRuntimeFailure(error, {
      code: input.failureFallback?.code ?? "UNKNOWN_RUNTIME_FAILURE",
      category: input.failureFallback?.category ?? "unknown",
      stage: input.failureFallback?.stage ?? input.stage,
      severity: input.failureFallback?.severity,
      retryable: input.failureFallback?.retryable,
      suggestedAction: input.failureFallback?.suggestedAction,
      correlationId: input.correlationId,
      metadata: input.failureFallback?.metadata ?? {},
    });
  }
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("operation timed out")
  );
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}
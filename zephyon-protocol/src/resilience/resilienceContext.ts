// src/resilience/resilienceContext.ts

import type { RuntimeFailure } from "./failure";
import type { RecoveryDecision } from "./recovery";
import type { RetryDecision, RetryPolicy } from "./retryPolicy";
import { DEFAULT_RETRY_POLICY } from "./retryPolicy";

export type ResilienceAttempt = {
  attempt: number;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  failure?: RuntimeFailure;
  recoveryDecision?: RecoveryDecision;
  retryDecision?: RetryDecision;
};

export type ResilienceContextInput = {
  correlationId: string;
  maxAttempts?: number;
  retryPolicy?: RetryPolicy;
  metadata?: Record<string, unknown>;
};

export type ResilienceContextSnapshot = {
  correlationId: string;
  currentAttempt: number;
  maxAttempts: number;
  retryPolicy: RetryPolicy;
  attempts: ResilienceAttempt[];
  lastFailure?: RuntimeFailure;
  metadata: Record<string, unknown>;
};

export class ResilienceContext {
  private currentAttempt = 0;
  private readonly attempts: ResilienceAttempt[] = [];
  private lastFailure?: RuntimeFailure;
  private readonly correlationId: string;
  private readonly retryPolicy: RetryPolicy;
  private readonly metadata: Record<string, unknown>;

  constructor(input: ResilienceContextInput) {
    this.correlationId = input.correlationId;

    this.retryPolicy = input.retryPolicy ?? {
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: input.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts,
    };

    this.metadata = input.metadata ?? {};
  }

  startAttempt(now: string = new Date().toISOString()): ResilienceAttempt {
    this.currentAttempt += 1;

    const attempt: ResilienceAttempt = {
      attempt: this.currentAttempt,
      startedAt: now,
    };

    this.attempts.push(attempt);

    return attempt;
  }

  completeAttempt(now: string = new Date().toISOString()): void {
    const attempt = this.getCurrentAttempt();

    if (!attempt || attempt.completedAt) {
      return;
    }

    attempt.completedAt = now;
    attempt.durationMs = calculateDurationMs(attempt.startedAt, now);
  }

  recordFailure(
    failure: RuntimeFailure,
    recoveryDecision?: RecoveryDecision,
    retryDecision?: RetryDecision,
  ): void {
    const attempt = this.getCurrentAttempt();

    this.lastFailure = failure;

    if (!attempt) {
      return;
    }

    attempt.failure = failure;
    attempt.recoveryDecision = recoveryDecision;
    attempt.retryDecision = retryDecision;
  }

  getAttemptNumber(): number {
    return this.currentAttempt;
  }

  getRetryPolicy(): RetryPolicy {
    return this.retryPolicy;
  }

  getLastFailure(): RuntimeFailure | undefined {
    return this.lastFailure;
  }

  snapshot(): ResilienceContextSnapshot {
    return {
      correlationId: this.correlationId,
      currentAttempt: this.currentAttempt,
      maxAttempts: this.retryPolicy.maxAttempts,
      retryPolicy: { ...this.retryPolicy },
      attempts: this.attempts.map((attempt) => ({ ...attempt })),
      lastFailure: this.lastFailure,
      metadata: { ...this.metadata },
    };
  }

  private getCurrentAttempt(): ResilienceAttempt | undefined {
    return this.attempts[this.attempts.length - 1];
  }
}

function calculateDurationMs(startedAt: string, completedAt: string): number {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0;
  }

  return Math.max(0, end - start);
}

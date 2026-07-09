// src/resilience/timeoutPolicy.ts

import type { RuntimeFailureStage } from "./failure";

export type TimeoutPolicy = {
  stage: RuntimeFailureStage;
  timeoutMs: number;
};

export type TimeoutPolicyMap = Partial<Record<RuntimeFailureStage, number>>;

export type TimeoutDecision = {
  stage: RuntimeFailureStage;
  timeoutMs: number;
  startedAt: number;
  deadlineAt: number;
};

export const DEFAULT_TIMEOUT_POLICY: TimeoutPolicyMap = {
  runtime: 60_000,
  identity: 500,
  compliance: 1_000,
  risk: 1_000,
  policy: 500,
  trust: 750,
  orchestration: 30_000,
  adapter: 15_000,
  settlement: 45_000,
  telemetry: 1_000,
  receipt: 2_000,
};

export function getTimeoutForStage(
  stage: RuntimeFailureStage,
  policy: TimeoutPolicyMap = DEFAULT_TIMEOUT_POLICY,
): number {
  return policy[stage] ?? DEFAULT_TIMEOUT_POLICY[stage] ?? 10_000;
}

export function createTimeoutDecision(
  stage: RuntimeFailureStage,
  policy: TimeoutPolicyMap = DEFAULT_TIMEOUT_POLICY,
  now: number = Date.now(),
): TimeoutDecision {
  const timeoutMs = getTimeoutForStage(stage, policy);

  return {
    stage,
    timeoutMs,
    startedAt: now,
    deadlineAt: now + timeoutMs,
  };
}

export function hasTimedOut(
  decision: TimeoutDecision,
  now: number = Date.now(),
): boolean {
  return now >= decision.deadlineAt;
}

export async function withTimeout<T>(
  operation: Promise<T>,
  decision: TimeoutDecision,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `Operation timed out during ${decision.stage} after ${decision.timeoutMs}ms`,
        ),
      );
    }, decision.timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
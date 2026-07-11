// src/resilience/circuitBreaker.ts

export type CircuitBreakerState = "closed" | "open" | "half_open";

export type CircuitBreakerConfig = {
  failureThreshold: number;
  successThreshold: number;
  cooldownMs: number;
};

export type CircuitBreakerSnapshot = {
  name: string;
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  openedAt?: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
};

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  successThreshold: 2,
  cooldownMs: 30_000,
};

export class CircuitBreaker {
  private state: CircuitBreakerState = "closed";
  private failureCount = 0;
  private successCount = 0;
  private openedAt?: number;
  private lastFailureAt?: number;
  private lastSuccessAt?: number;

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG,
  ) {}

  canAttempt(now: number = Date.now()): boolean {
    if (this.state === "closed") {
      return true;
    }

    if (this.state === "half_open") {
      return true;
    }

    if (!this.openedAt) {
      return false;
    }

    if (now - this.openedAt >= this.config.cooldownMs) {
      this.transitionToHalfOpen();
      return true;
    }

    return false;
  }

  recordSuccess(now: number = Date.now()): void {
    this.lastSuccessAt = now;

    if (this.state === "half_open") {
      this.successCount += 1;

      if (this.successCount >= this.config.successThreshold) {
        this.transitionToClosed();
      }

      return;
    }

    if (this.state === "closed") {
      this.failureCount = 0;
      this.successCount += 1;
    }
  }

  recordFailure(now: number = Date.now()): void {
    this.lastFailureAt = now;
    this.failureCount += 1;
    this.successCount = 0;

    if (this.state === "half_open") {
      this.transitionToOpen(now);
      return;
    }

    if (
      this.state === "closed" &&
      this.failureCount >= this.config.failureThreshold
    ) {
      this.transitionToOpen(now);
    }
  }

  snapshot(): CircuitBreakerSnapshot {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      openedAt: this.openedAt,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
    };
  }

  reset(): void {
    this.transitionToClosed();
  }

  private transitionToClosed(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.successCount = 0;
    this.openedAt = undefined;
  }

  private transitionToOpen(now: number = Date.now()): void {
    this.state = "open";
    this.openedAt = now;
    this.successCount = 0;
  }

  private transitionToHalfOpen(): void {
    this.state = "half_open";
    this.successCount = 0;
  }
}
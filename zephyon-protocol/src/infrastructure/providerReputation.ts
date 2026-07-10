import type { ProviderHistorySnapshot } from "./providerHistory";

export type ProviderReputation = {
  endpointId: string;
  provider: string;
  network: string;
  score: number;
  confidence: number;
  successRate: number;
  averageLatencyMs: number | null;
  reasons: string[];
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function latencyReputationScore(
  averageLatencyMs: number | null,
): number {
  if (averageLatencyMs === null) return 40;
  if (averageLatencyMs <= 100) return 100;
  if (averageLatencyMs <= 200) return 95;
  if (averageLatencyMs <= 300) return 90;
  if (averageLatencyMs <= 500) return 80;
  if (averageLatencyMs <= 750) return 70;
  if (averageLatencyMs <= 1_000) return 60;
  if (averageLatencyMs <= 2_500) return 40;

  return 20;
}

export function calculateProviderReputation(
  history: ProviderHistorySnapshot,
): ProviderReputation {
  const reasons: string[] = [];

  const reliabilityScore = history.successRate;
  const latencyScore = latencyReputationScore(
    history.averageLatencyMs,
  );

  const degradedRate =
    history.totalObservations === 0
      ? 0
      : (history.degradedObservations /
          history.totalObservations) *
        100;

  const degradedPenalty = Math.min(20, degradedRate * 0.5);

  const weightedScore =
    reliabilityScore * 0.7 +
    latencyScore * 0.3 -
    degradedPenalty;

  const confidence = clamp(
    Math.min(100, history.totalObservations * 5),
  );

  reasons.push(
    `Historical success rate: ${history.successRate}%.`,
  );

  reasons.push(
    history.averageLatencyMs === null
      ? "Historical latency unavailable."
      : `Historical average latency: ${history.averageLatencyMs}ms.`,
  );

  if (degradedPenalty > 0) {
    reasons.push(
      `Degraded-observation penalty: -${round(degradedPenalty)}.`,
    );
  }

  reasons.push(
    `Confidence based on ${history.totalObservations} observations: ${round(confidence)}%.`,
  );

  return {
    endpointId: history.endpointId,
    provider: history.provider,
    network: history.network,
    score: round(clamp(weightedScore)),
    confidence: round(confidence),
    successRate: history.successRate,
    averageLatencyMs: history.averageLatencyMs,
    reasons,
  };
}

export function calculateProviderReputations(
  histories: ProviderHistorySnapshot[],
): ProviderReputation[] {
  return histories
    .map(calculateProviderReputation)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return b.confidence - a.confidence;
    });
}
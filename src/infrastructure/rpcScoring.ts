import type { RpcHealthResult } from "./rpcHealth";

export type RpcScoreComponent = {
  name: string;
  value: number;
  reason: string;
};

export type RpcScore = {
  endpointId: string;
  score: number;
  rankable: boolean;
  reasons: string[];
  components: RpcScoreComponent[];
  health: RpcHealthResult;
};

export type RpcScoringOptions = {
  unreachableScore?: number;
  missingNetworkDataPenalty?: number;
  degradedPenalty?: number;
};

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score * 100) / 100));
}

function scoreLatency(latencyMs: number): number {
  if (latencyMs <= 50) return 100;
  if (latencyMs <= 100) return 98;
  if (latencyMs <= 150) return 96;
  if (latencyMs <= 200) return 94;
  if (latencyMs <= 250) return 92;
  if (latencyMs <= 300) return 90;
  if (latencyMs <= 400) return 87;
  if (latencyMs <= 500) return 83;
  if (latencyMs <= 750) return 75;
  if (latencyMs <= 1_000) return 65;
  if (latencyMs <= 2_500) return 45;

  return 25;
}

export function scoreRpcHealth(
  health: RpcHealthResult,
  options: RpcScoringOptions = {},
): RpcScore {
  const unreachableScore = options.unreachableScore ?? 0;
  const missingNetworkDataPenalty = options.missingNetworkDataPenalty ?? 15;
  const degradedPenalty = options.degradedPenalty ?? 10;

  const reasons: string[] = [];
  const components: RpcScoreComponent[] = [];

  if (!health.reachable) {
    const reason = health.error?.message
      ? `Endpoint unreachable: ${health.error.message}`
      : "Endpoint unreachable.";

    return {
      endpointId: health.endpointId,
      score: clampScore(unreachableScore),
      rankable: false,
      reasons: [reason],
      components: [
        {
          name: "reachability",
          value: unreachableScore,
          reason,
        },
      ],
      health,
    };
  }

  let score = 100;

  if (health.latencyMs === null) {
    score -= 50;

    reasons.push("Latency unavailable.");
    components.push({
      name: "latency",
      value: 50,
      reason: "Latency unavailable.",
    });
  } else {
    const latencyScore = scoreLatency(health.latencyMs);
    score = latencyScore;

    const reason = `Latency ${health.latencyMs}ms produced score ${latencyScore}.`;

    reasons.push(reason);
    components.push({
      name: "latency",
      value: latencyScore,
      reason,
    });
  }

  if (health.status === "degraded") {
    score -= degradedPenalty;

    const reason = `Degraded health penalty: -${degradedPenalty}.`;

    reasons.push(reason);
    components.push({
      name: "health-status",
      value: -degradedPenalty,
      reason,
    });
  }

  if (health.slot === null || health.blockHeight === null) {
    score -= missingNetworkDataPenalty;

    const reason =
      `Missing slot or block-height penalty: -${missingNetworkDataPenalty}.`;

    reasons.push(reason);
    components.push({
      name: "network-data",
      value: -missingNetworkDataPenalty,
      reason,
    });
  } else {
    components.push({
      name: "network-data",
      value: 0,
      reason: "Slot and block height available.",
    });
  }

  const finalScore = clampScore(score);

  return {
    endpointId: health.endpointId,
    score: finalScore,
    rankable: finalScore > 0,
    reasons,
    components,
    health,
  };
}

export function scoreManyRpcHealthResults(
  healthResults: RpcHealthResult[],
  options: RpcScoringOptions = {},
): RpcScore[] {
  return healthResults
    .map((health) => scoreRpcHealth(health, options))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      const aLatency = a.health.latencyMs ?? Number.POSITIVE_INFINITY;
      const bLatency = b.health.latencyMs ?? Number.POSITIVE_INFINITY;

      return aLatency - bLatency;
    });
}
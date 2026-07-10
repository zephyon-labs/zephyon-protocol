import type { RpcEndpoint, RpcNetwork } from "./rpcEndpoint";
import type { RpcScore } from "./rpcScoring";

export type RpcSelectionReason =
  | "highest-score"
  | "lowest-latency-tiebreak"
  | "configured-priority-tiebreak"
  | "priority-fallback"
  | "no-available-endpoint";

export type RpcSelection = {
  selectedEndpoint: RpcEndpoint | null;
  selectedScore: RpcScore | null;
  reason: RpcSelectionReason;
  consideredEndpoints: number;
};

type RankedCandidate = {
  endpoint: RpcEndpoint;
  score: RpcScore;
};

function compareCandidates(
  a: RankedCandidate,
  b: RankedCandidate,
): number {
  if (b.score.score !== a.score.score) {
    return b.score.score - a.score.score;
  }

  const aLatency =
    a.score.health.latencyMs ?? Number.POSITIVE_INFINITY;
  const bLatency =
    b.score.health.latencyMs ?? Number.POSITIVE_INFINITY;

  if (aLatency !== bLatency) {
    return aLatency - bLatency;
  }

  if (a.endpoint.priority !== b.endpoint.priority) {
    return a.endpoint.priority - b.endpoint.priority;
  }

  return a.endpoint.name.localeCompare(b.endpoint.name);
}

function determineSelectionReason(
  selected: RankedCandidate,
  second: RankedCandidate | undefined,
): RpcSelectionReason {
  if (!second) return "highest-score";

  if (selected.score.score !== second.score.score) {
    return "highest-score";
  }

  const selectedLatency =
    selected.score.health.latencyMs ?? Number.POSITIVE_INFINITY;
  const secondLatency =
    second.score.health.latencyMs ?? Number.POSITIVE_INFINITY;

  if (selectedLatency !== secondLatency) {
    return "lowest-latency-tiebreak";
  }

  if (selected.endpoint.priority !== second.endpoint.priority) {
    return "configured-priority-tiebreak";
  }

  return "configured-priority-tiebreak";
}

export function selectBestRpcEndpoint(
  endpoints: RpcEndpoint[],
  scores: RpcScore[],
  network?: RpcNetwork,
): RpcSelection {
  const endpointById = new Map(
    endpoints.map((endpoint) => [endpoint.id, endpoint]),
  );

  const candidates: RankedCandidate[] = scores
    .filter((score) => score.rankable)
    .flatMap((score): RankedCandidate[] => {
      const endpoint = endpointById.get(score.endpointId);

      if (!endpoint) return [];
      if (network && endpoint.network !== network) return [];

      return [{ endpoint, score }];
    })
    .sort(compareCandidates);

  const selected = candidates[0];

  if (selected) {
    return {
      selectedEndpoint: selected.endpoint,
      selectedScore: selected.score,
      reason: determineSelectionReason(selected, candidates[1]),
      consideredEndpoints: candidates.length,
    };
  }

  const fallback = endpoints
    .filter((endpoint) => (network ? endpoint.network === network : true))
    .filter((endpoint) => endpoint.status === "active")
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }

      return a.name.localeCompare(b.name);
    })[0];

  if (fallback) {
    return {
      selectedEndpoint: fallback,
      selectedScore: null,
      reason: "priority-fallback",
      consideredEndpoints: endpoints.length,
    };
  }

  return {
    selectedEndpoint: null,
    selectedScore: null,
    reason: "no-available-endpoint",
    consideredEndpoints: endpoints.length,
  };
}
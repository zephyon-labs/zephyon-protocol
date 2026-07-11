import type { RpcHealthResult } from "./rpcHealth";

export type ProviderHealthObservation = {
  endpointId: string;
  provider: string;
  network: string;
  reachable: boolean;
  status: RpcHealthResult["status"];
  latencyMs: number | null;
  slot: number | null;
  blockHeight: number | null;
  observedAt: string;
};

export type ProviderHistorySnapshot = {
  endpointId: string;
  provider: string;
  network: string;
  totalObservations: number;
  successfulObservations: number;
  failedObservations: number;
  degradedObservations: number;
  successRate: number;
  averageLatencyMs: number | null;
  minimumLatencyMs: number | null;
  maximumLatencyMs: number | null;
  lastObservedAt: string | null;
  lastHealthyAt: string | null;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export class ProviderHistory {
  private readonly observations = new Map<
    string,
    ProviderHealthObservation[]
  >();

  record(result: RpcHealthResult): ProviderHealthObservation {
    const observation: ProviderHealthObservation = {
      endpointId: result.endpointId,
      provider: result.provider,
      network: result.network,
      reachable: result.reachable,
      status: result.status,
      latencyMs: result.latencyMs,
      slot: result.slot,
      blockHeight: result.blockHeight,
      observedAt: result.checkedAt,
    };

    const current = this.observations.get(result.endpointId) ?? [];
    current.push(observation);

    this.observations.set(result.endpointId, current);

    return observation;
  }

  recordMany(results: RpcHealthResult[]): ProviderHealthObservation[] {
    return results.map((result) => this.record(result));
  }

  list(endpointId: string): ProviderHealthObservation[] {
    return [...(this.observations.get(endpointId) ?? [])];
  }

  snapshot(endpointId: string): ProviderHistorySnapshot | null {
    const entries = this.observations.get(endpointId);

    if (!entries || entries.length === 0) {
      return null;
    }

    const successful = entries.filter((entry) => entry.reachable);
    const failed = entries.filter((entry) => !entry.reachable);
    const degraded = entries.filter(
      (entry) => entry.status === "degraded",
    );

    const latencies = successful
      .map((entry) => entry.latencyMs)
      .filter((latency): latency is number => latency !== null);

    const lastHealthyEntry = [...entries]
      .reverse()
      .find((entry) => entry.status === "healthy");

    return {
      endpointId,
      provider: entries[0].provider,
      network: entries[0].network,
      totalObservations: entries.length,
      successfulObservations: successful.length,
      failedObservations: failed.length,
      degradedObservations: degraded.length,
      successRate: round(
        (successful.length / entries.length) * 100,
      ),
      averageLatencyMs:
        latencies.length === 0
          ? null
          : round(
              latencies.reduce((sum, latency) => sum + latency, 0) /
                latencies.length,
            ),
      minimumLatencyMs:
        latencies.length === 0 ? null : Math.min(...latencies),
      maximumLatencyMs:
        latencies.length === 0 ? null : Math.max(...latencies),
      lastObservedAt:
  entries.length > 0
    ? entries[entries.length - 1].observedAt
    : null,
      lastHealthyAt: lastHealthyEntry?.observedAt ?? null,
    };
  }

  snapshots(): ProviderHistorySnapshot[] {
    return [...this.observations.keys()]
      .map((endpointId) => this.snapshot(endpointId))
      .filter(
        (snapshot): snapshot is ProviderHistorySnapshot =>
          snapshot !== null,
      );
  }

  clear(endpointId?: string): void {
    if (endpointId) {
      this.observations.delete(endpointId);
      return;
    }

    this.observations.clear();
  }
}
import { maskUrl } from "../config/environment";
import type { RpcNetwork } from "./rpcEndpoint";
import type { RpcRegistry } from "./rpcRegistry";
import {
  checkManyRpcEndpoints,
  type RpcHealthCheckOptions,
  type RpcHealthResult,
} from "./rpcHealth";
import {
  scoreManyRpcHealthResults,
  type RpcScore,
  type RpcScoringOptions,
} from "./rpcScoring";
import {
  selectBestRpcEndpoint,
  type RpcSelection,
} from "./rpcSelector";

export type InfrastructureValidationOptions = {
  network?: RpcNetwork;
  health?: RpcHealthCheckOptions;
  scoring?: RpcScoringOptions;
};

export type InfrastructureValidationReport = {
  generatedAt: string;
  network: RpcNetwork | "all";
  endpointsTested: number;
  healthyEndpoints: number;
  degradedEndpoints: number;
  unhealthyEndpoints: number;
  healthResults: RpcHealthResult[];
  scores: RpcScore[];
  selection: RpcSelection;
};

export async function validateRpcInfrastructure(
  registry: RpcRegistry,
  options: InfrastructureValidationOptions = {},
): Promise<InfrastructureValidationReport> {
  const endpoints = options.network
    ? registry.listUsable(options.network)
    : registry.listUsable();

  const healthResults = await checkManyRpcEndpoints(
    endpoints,
    options.health,
  );

  const scores = scoreManyRpcHealthResults(
    healthResults,
    options.scoring,
  );

  const selection = selectBestRpcEndpoint(
    endpoints,
    scores,
    options.network,
  );

  return {
    generatedAt: new Date().toISOString(),
    network: options.network ?? "all",
    endpointsTested: endpoints.length,
    healthyEndpoints: healthResults.filter(
      (result) => result.status === "healthy",
    ).length,
    degradedEndpoints: healthResults.filter(
      (result) => result.status === "degraded",
    ).length,
    unhealthyEndpoints: healthResults.filter(
      (result) => result.status === "unhealthy",
    ).length,
    healthResults,
    scores,
    selection,
  };
}

export function formatInfrastructureValidationReport(
  report: InfrastructureValidationReport,
): string {
  const lines: string[] = [];

  lines.push("========================================");
  lines.push("ZEPHYON INFRASTRUCTURE VALIDATION");
  lines.push("========================================");
  lines.push("");
  lines.push(`Generated At        : ${report.generatedAt}`);
  lines.push(`Network             : ${report.network}`);
  lines.push(`Endpoints Tested    : ${report.endpointsTested}`);
  lines.push(`Healthy             : ${report.healthyEndpoints}`);
  lines.push(`Degraded            : ${report.degradedEndpoints}`);
  lines.push(`Unhealthy           : ${report.unhealthyEndpoints}`);
  lines.push("");

  lines.push("RPC Scores:");
  lines.push("----------------------------------------");

  for (const score of report.scores) {
    lines.push(`${score.health.endpointName}`);
    lines.push(`  Provider          : ${score.health.provider}`);
    lines.push(`  URL               : ${maskUrl(score.health.url)}`);
    lines.push(`  Status            : ${score.health.status}`);
    lines.push(`  Reachable         : ${score.health.reachable}`);
    lines.push(
      `  Latency           : ${score.health.latencyMs ?? "n/a"}ms`,
    );
    lines.push(`  Slot              : ${score.health.slot ?? "n/a"}`);
    lines.push(
      `  Block Height      : ${score.health.blockHeight ?? "n/a"}`,
    );
    lines.push(`  Score             : ${score.score}`);
    lines.push(`  Reasons           : ${score.reasons.join(" | ")}`);
    lines.push("");
  }

  lines.push("Selected RPC:");
  lines.push("----------------------------------------");

  const selected = report.selection.selectedEndpoint;

  if (selected) {
    lines.push(`Endpoint            : ${selected.name}`);
    lines.push(`Provider            : ${selected.provider}`);
    lines.push(`Network             : ${selected.network}`);
    lines.push(`URL                 : ${maskUrl(selected.url)}`);
    lines.push(`Reason              : ${report.selection.reason}`);
    lines.push(
      `Score               : ${
        report.selection.selectedScore?.score ??
        "priority-fallback"
      }`,
    );
  } else {
    lines.push("Endpoint            : none");
    lines.push(`Reason              : ${report.selection.reason}`);
  }

  lines.push("");
  lines.push("========================================");

  return lines.join("\n");
}
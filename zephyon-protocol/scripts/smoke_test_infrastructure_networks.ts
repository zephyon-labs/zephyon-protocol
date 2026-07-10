import {
  createConfiguredRpcRegistry,
  validateRpcInfrastructure,
  type InfrastructureValidationReport,
  type RpcNetwork,
} from "../src/infrastructure";
import { maskUrl } from "../src/config";
const NETWORKS_TO_VALIDATE: RpcNetwork[] = [
  "devnet",
  "testnet",
  "mainnet-beta",
];

function getAverageLatency(reports: InfrastructureValidationReport[]): number | null {
  const latencies = reports
    .flatMap((report) => report.healthResults)
    .map((result) => result.latencyMs)
    .filter((latency): latency is number => latency !== null);

  if (latencies.length === 0) return null;

  const total = latencies.reduce((sum, latency) => sum + latency, 0);
  return Math.round(total / latencies.length);
}

function sumReports(
  reports: InfrastructureValidationReport[],
  key: "endpointsTested" | "healthyEndpoints" | "degradedEndpoints" | "unhealthyEndpoints",
): number {
  return reports.reduce((sum, report) => sum + report[key], 0);
}

function getInfrastructureStatus(reports: InfrastructureValidationReport[]): string {
  const totalEndpoints = sumReports(reports, "endpointsTested");
  const healthyEndpoints = sumReports(reports, "healthyEndpoints");
  const degradedEndpoints = sumReports(reports, "degradedEndpoints");
  const unhealthyEndpoints = sumReports(reports, "unhealthyEndpoints");

  if (totalEndpoints === 0) return "NO ENDPOINTS REGISTERED";
  if (unhealthyEndpoints === 0 && degradedEndpoints === 0 && healthyEndpoints === totalEndpoints) {
    return "EXCELLENT";
  }
  if (healthyEndpoints > 0 && unhealthyEndpoints < totalEndpoints) {
    return "DEGRADED BUT OPERATIONAL";
  }

  return "UNHEALTHY";
}

function printNetworkReport(report: InfrastructureValidationReport): void {
  const selected = report.selection.selectedEndpoint;
  const selectedScore = report.selection.selectedScore;

  console.log(report.network.toUpperCase());
  console.log("----------------------------------------");
  console.log(`Endpoints Tested : ${report.endpointsTested}`);
  console.log(`Healthy          : ${report.healthyEndpoints}`);
  console.log(`Degraded         : ${report.degradedEndpoints}`);
  console.log(`Unhealthy        : ${report.unhealthyEndpoints}`);

  if (selected) {
    console.log(`Selected RPC     : ${selected.name}`);
    console.log(`Provider         : ${selected.provider}`);
    console.log(`URL              : ${maskUrl(selected.url)}`);
    console.log(`Reason           : ${report.selection.reason}`);
    console.log(`Score            : ${selectedScore?.score ?? "priority-fallback"}`);
  } else {
    console.log("Selected RPC     : none");
    console.log(`Reason           : ${report.selection.reason}`);
  }

  console.log("");

  if (report.scores.length === 0) {
    console.log("  No RPC scores available.");
    console.log("");
    return;
  }

  for (const score of report.scores) {
    console.log(`  ${score.health.endpointName}`);
    console.log(`    Provider     : ${score.health.provider}`);
    console.log(`    Status       : ${score.health.status}`);
    console.log(`    Reachable    : ${score.health.reachable}`);
    console.log(`    Latency      : ${score.health.latencyMs ?? "n/a"}ms`);
    console.log(`    Slot         : ${score.health.slot ?? "n/a"}`);
    console.log(`    Block Height : ${score.health.blockHeight ?? "n/a"}`);
    console.log(`    Score        : ${score.score}`);
    console.log(`    Reason       : ${score.reasons.join(" | ")}`);
    console.log("");
  }
}

async function main(): Promise<void> {
  const registry = createConfiguredRpcRegistry();
  const snapshot = registry.snapshot();
  const reports: InfrastructureValidationReport[] = [];

  console.log("========================================");
  console.log("ZEPHYON NETWORK VALIDATION");
  console.log("========================================");
  console.log("");
  console.log(`Registered Endpoints : ${snapshot.totalEndpoints}`);
  console.log(`Usable Endpoints     : ${snapshot.usableEndpoints}`);
  console.log(`Disabled Endpoints   : ${snapshot.disabledEndpoints}`);
  console.log(`Networks             : ${snapshot.networks.join(", ")}`);
  console.log(`Providers            : ${snapshot.providers.join(", ")}`);
  console.log("");

  for (const network of NETWORKS_TO_VALIDATE) {
    const report = await validateRpcInfrastructure(registry, {
      network,
      health: {
        timeoutMs: 5_000,
        commitment: "confirmed",
      },
    });

    reports.push(report);
    printNetworkReport(report);
  }

  const averageLatency = getAverageLatency(reports);
  const infrastructureStatus = getInfrastructureStatus(reports);

  console.log("========================================");
  console.log("SUMMARY");
  console.log("========================================");
  console.log("");
  console.log(`Networks Tested  : ${reports.length}`);
  console.log(`Endpoints Tested : ${sumReports(reports, "endpointsTested")}`);
  console.log(`Healthy          : ${sumReports(reports, "healthyEndpoints")}`);
  console.log(`Degraded         : ${sumReports(reports, "degradedEndpoints")}`);
  console.log(`Unhealthy        : ${sumReports(reports, "unhealthyEndpoints")}`);
  console.log(`Average Latency  : ${averageLatency === null ? "n/a" : `${averageLatency}ms`}`);
  console.log("");
  console.log(`Infrastructure Status: ${infrastructureStatus}`);
  console.log("========================================");
}

main().catch((error: unknown) => {
  console.error("Network infrastructure smoke test failed.");
  console.error(error);
  throw error;
});
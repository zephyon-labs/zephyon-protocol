import { runRpcDiagnostics } from "./diagnostics";
import type { RpcHealthResult, RpcHealthStatus } from "./health";

export type ProtocolLabStatus = "green" | "yellow" | "red";

export type ProtocolLabReport = {
  status: ProtocolLabStatus;
  checkedAt: string;
  rpc: {
    reports: RpcHealthResult[];
    healthyCount: number;
    degradedCount: number;
    unreachableCount: number;
    averageLatencyMs: number;
  };
  warnings: string[];
  errors: string[];
  recommendations: string[];
};

export async function generateProtocolLabReport(): Promise<ProtocolLabReport> {
  const rpcReports = await runRpcDiagnostics();

  const healthyCount = countByStatus(rpcReports, "healthy");
  const degradedCount = countByStatus(rpcReports, "degraded");
  const unreachableCount = countByStatus(rpcReports, "unreachable");

  const averageLatencyMs =
    rpcReports.length === 0
      ? 0
      : Math.round(
          rpcReports.reduce((sum, report) => sum + report.latencyMs, 0) /
            rpcReports.length
        );

  const warnings = buildWarnings(rpcReports);
  const errors = buildErrors(rpcReports);
  const recommendations = buildRecommendations(rpcReports);

  return {
    status: determineOverallStatus(unreachableCount, degradedCount),
    checkedAt: new Date().toISOString(),
    rpc: {
      reports: rpcReports,
      healthyCount,
      degradedCount,
      unreachableCount,
      averageLatencyMs,
    },
    warnings,
    errors,
    recommendations,
  };
}

function countByStatus(
  reports: RpcHealthResult[],
  status: RpcHealthStatus
): number {
  return reports.filter((report) => report.status === status).length;
}

function determineOverallStatus(
  unreachableCount: number,
  degradedCount: number
): ProtocolLabStatus {
  if (unreachableCount > 0) {
    return "red";
  }

  if (degradedCount > 0) {
    return "yellow";
  }

  return "green";
}

function buildWarnings(reports: RpcHealthResult[]): string[] {
  return reports
    .filter((report) => report.status === "degraded")
    .map((report) => `${report.label} is degraded.`);
}

function buildErrors(reports: RpcHealthResult[]): string[] {
  return reports
    .filter((report) => report.status === "unreachable")
    .map((report) => `${report.label} is unreachable.`);
}

function buildRecommendations(reports: RpcHealthResult[]): string[] {
  const recommendations: string[] = [];

  if (reports.some((report) => report.status === "unreachable")) {
    recommendations.push("Do not proceed with transaction testing until unreachable RPC endpoints recover or are removed.");
  }

  if (reports.some((report) => report.status === "degraded")) {
    recommendations.push("Use healthy RPC endpoints for simulations and avoid degraded endpoints for critical tests.");
  }

  if (reports.length > 0 && reports.every((report) => report.status === "healthy")) {
    recommendations.push("RPC diagnostics are healthy. Proceed to protocol account validation.");
  }

  return recommendations;
}
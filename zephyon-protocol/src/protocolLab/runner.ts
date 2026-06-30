import { DEFAULT_ENVIRONMENT } from "./config";
import { generateProtocolLabReport } from "./report";
import { validateProtocolEnvironment } from "./validator";

export async function runProtocolLab(): Promise<void> {
  const report = await generateProtocolLabReport();
  const validation = await validateProtocolEnvironment(DEFAULT_ENVIRONMENT);

  console.log("");
  console.log("========================================");
  console.log("      ZEPHYON PROTOCOL LAB REPORT");
  console.log("========================================");
  console.log("");

  console.log(`Overall Status : ${validation.status.toUpperCase()}`);
  console.log(`Environment    : ${validation.environmentName}`);
  console.log(`Cluster        : ${validation.cluster}`);
  console.log(`Checked At     : ${validation.checkedAt}`);
  console.log("");

  console.log("RPC Diagnostics");
  console.log("----------------------------");
  console.log(`Healthy      : ${report.rpc.healthyCount}`);
  console.log(`Degraded     : ${report.rpc.degradedCount}`);
  console.log(`Unreachable  : ${report.rpc.unreachableCount}`);
  console.log(`Avg Latency  : ${report.rpc.averageLatencyMs} ms`);
  console.log("");

  console.log("Selected RPC");
  console.log("----------------------------");
  console.log(`Label       : ${validation.rpc.label}`);
  console.log(`Status      : ${validation.rpc.status}`);
  console.log(`Environment : ${validation.rpc.environment}`);
  console.log(`Latency     : ${validation.rpc.latencyMs} ms`);
  console.log(`Slot        : ${validation.rpc.slot ?? "N/A"}`);
  console.log(`Block       : ${validation.rpc.blockHeight ?? "N/A"}`);
  console.log(`Version     : ${validation.rpc.version ?? "Unknown"}`);
  console.log("");

  console.log("Program Validation");
  console.log("----------------------------");
  console.log(`Program ID  : ${validation.program.programId}`);
  console.log(`Status      : ${validation.program.status}`);
  console.log(`Exists      : ${validation.program.exists}`);
  console.log(`Executable  : ${validation.program.executable}`);
  console.log(`Owner       : ${validation.program.owner ?? "Unknown"}`);
  console.log(`Lamports    : ${validation.program.lamports ?? "N/A"}`);
  console.log(`Data Length : ${validation.program.dataLength ?? "N/A"}`);
  console.log("");

  console.log("Treasury Validation");
  console.log("----------------------------");
  console.log(`Treasury PDA: ${validation.treasury.treasuryPda ?? "Not configured"}`);
  console.log(`Status      : ${validation.treasury.status}`);
  console.log(`Exists      : ${validation.treasury.exists}`);
  console.log(`Executable  : ${validation.treasury.executable}`);
  console.log(`Owner       : ${validation.treasury.owner ?? "Unknown"}`);
  console.log(`Lamports    : ${validation.treasury.lamports ?? "N/A"}`);
  console.log(`Data Length : ${validation.treasury.dataLength ?? "N/A"}`);
  console.log("");

  if (validation.warnings.length > 0) {
    console.log("Warnings");
    console.log("----------------------------");

    for (const warning of validation.warnings) {
      console.log(`• ${warning}`);
    }

    console.log("");
  }

  if (validation.errors.length > 0) {
    console.log("Errors");
    console.log("----------------------------");

    for (const error of validation.errors) {
      console.log(`• ${error}`);
    }

    console.log("");
  }

  console.log("Recommendations");
  console.log("----------------------------");

  for (const recommendation of validation.recommendations) {
    console.log(`• ${recommendation}`);
  }

  console.log("");
  console.log("========================================");
}
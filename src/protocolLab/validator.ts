import { checkRpcHealth } from "./health";
import { validateProgramAccount } from "./program";
import { validateTreasuryAccount } from "./treasury";
import type { ProtocolEnvironment } from "./config";

export type ValidationStatus = "green" | "yellow" | "red";

export type ProtocolValidationResult = {
  environmentName: string;
  cluster: string;
  status: ValidationStatus;
  checkedAt: string;
  rpc: Awaited<ReturnType<typeof checkRpcHealth>>;
  program: Awaited<ReturnType<typeof validateProgramAccount>>;
  treasury: Awaited<ReturnType<typeof validateTreasuryAccount>>;
  warnings: string[];
  errors: string[];
  recommendations: string[];
};

export async function validateProtocolEnvironment(
  environment: ProtocolEnvironment
): Promise<ProtocolValidationResult> {
  const [rpc, program, treasury] = await Promise.all([
    checkRpcHealth(environment.rpcEndpoint),
    validateProgramAccount(environment.rpcEndpoint, {
      programId: environment.programId,
    }),
    validateTreasuryAccount(environment),
  ]);

  const warnings = buildWarnings(rpc, program, treasury);
  const errors = buildErrors(rpc, program, treasury);
  const recommendations = buildRecommendations(rpc, program, treasury);

  return {
    environmentName: environment.name,
    cluster: environment.cluster,
    status: determineStatus(errors, warnings),
    checkedAt: new Date().toISOString(),
    rpc,
    program,
    treasury,
    warnings,
    errors,
    recommendations,
  };
}

function determineStatus(
  errors: string[],
  warnings: string[]
): ValidationStatus {
  if (errors.length > 0) {
    return "red";
  }

  if (warnings.length > 0) {
    return "yellow";
  }

  return "green";
}

function buildWarnings(
  rpc: Awaited<ReturnType<typeof checkRpcHealth>>,
  program: Awaited<ReturnType<typeof validateProgramAccount>>,
  treasury: Awaited<ReturnType<typeof validateTreasuryAccount>>
): string[] {
  const warnings: string[] = [];

  if (rpc.status === "degraded") {
    warnings.push(`${rpc.label} is degraded.`);
  }

  if (treasury.status === "unconfigured") {
    warnings.push("Treasury PDA is not configured.");
  }

  if (program.status === "invalid") {
    warnings.push("Program account exists but failed validation.");
  }

  return warnings;
}

function buildErrors(
  rpc: Awaited<ReturnType<typeof checkRpcHealth>>,
  program: Awaited<ReturnType<typeof validateProgramAccount>>,
  treasury: Awaited<ReturnType<typeof validateTreasuryAccount>>
): string[] {
  const errors: string[] = [];

  if (rpc.status === "unreachable") {
    errors.push(`${rpc.label} is unreachable.`);
  }

  if (program.status === "unavailable") {
    errors.push("Program account could not be checked.");
  }

  if (program.status === "invalid" && !program.exists) {
    errors.push("Program account was not found.");
  }

  if (treasury.status === "unavailable") {
    errors.push("Treasury account could not be checked.");
  }

  if (treasury.status === "invalid") {
    errors.push("Treasury account failed validation.");
  }

  return errors;
}

function buildRecommendations(
  rpc: Awaited<ReturnType<typeof checkRpcHealth>>,
  program: Awaited<ReturnType<typeof validateProgramAccount>>,
  treasury: Awaited<ReturnType<typeof validateTreasuryAccount>>
): string[] {
  const recommendations: string[] = [];

  if (rpc.status === "healthy" && program.status === "valid") {
    recommendations.push("RPC and program validation passed.");
  }

  if (treasury.status === "unconfigured") {
    recommendations.push("Configure the treasury PDA before treasury validation or transaction simulation.");
  }

  if (rpc.status !== "healthy") {
    recommendations.push("Use a healthy RPC endpoint before running simulations.");
  }

  if (program.status !== "valid") {
    recommendations.push("Resolve program validation issues before transaction testing.");
  }

  if (recommendations.length === 0) {
    recommendations.push("Protocol environment validation completed successfully.");
  }

  return recommendations;
}
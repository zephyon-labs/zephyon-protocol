import type { ProtocolEnvironment } from "./config";
import { validateProtocolEnvironment } from "./validator";

export type SimulationStatus =
  | "ready"
  | "blocked"
  | "warning";

export type SimulationRequest = {
  sender: string;
  receiver: string;
  amountUsd: number;
};

export type SimulationResult = {
  status: SimulationStatus;
  environment: string;
  checkedAt: string;
  request: SimulationRequest;
  validationPassed: boolean;
  estimatedComputeUnits?: number;
  estimatedFeeLamports?: number;
  warnings: string[];
  errors: string[];
};

export async function simulatePayment(
  environment: ProtocolEnvironment,
  request: SimulationRequest
): Promise<SimulationResult> {
  const validation = await validateProtocolEnvironment(environment);

  if (validation.status === "red") {
    return {
      status: "blocked",
      environment: environment.name,
      checkedAt: new Date().toISOString(),
      request,
      validationPassed: false,
      warnings: validation.warnings,
      errors: validation.errors,
    };
  }

  return {
    status:
      validation.status === "yellow"
        ? "warning"
        : "ready",
    environment: environment.name,
    checkedAt: new Date().toISOString(),
    request,
    validationPassed: true,
    estimatedComputeUnits: 0,
    estimatedFeeLamports: 0,
    warnings: validation.warnings,
    errors: [],
  };
}
import type { ProtocolEnvironment } from "./config";
import {
  simulateSplPayment,
  type PaymentSimulationRequest,
  type PaymentSimulationResult,
} from "./paymentSimulator";

export type BatchPaymentSimulationOptions = {
  delayMs?: number;
};

export type BatchPaymentSimulationResult = {
  environment: string;
  total: number;
  simulated: number;
  failed: number;
  blocked: number;
  averageUnitsConsumed: number;
  minUnitsConsumed?: number;
  maxUnitsConsumed?: number;
  delayMs: number;
  results: PaymentSimulationResult[];
  errors: string[];
  checkedAt: string;
};

export async function simulatePaymentBatch(
  environment: ProtocolEnvironment,
  requests: PaymentSimulationRequest[],
  options: BatchPaymentSimulationOptions = {}
): Promise<BatchPaymentSimulationResult> {
  const results: PaymentSimulationResult[] = [];
  const delayMs = options.delayMs ?? 500;

  for (let index = 0; index < requests.length; index++) {
    const request = requests[index];

    console.log(`Simulating payment ${index + 1}/${requests.length}...`);

    const result = await simulateSplPayment(environment, request);
    results.push(result);

    if (index < requests.length - 1) {
      await sleep(delayMs);
    }
  }

  const simulated = results.filter(
    (result) => result.status === "simulated"
  ).length;
  const failed = results.filter((result) => result.status === "failed").length;
  const blocked = results.filter((result) => result.status === "blocked").length;

  const consumedUnits = results
    .map((result) => result.unitsConsumed)
    .filter((value): value is number => typeof value === "number");

  const averageUnitsConsumed =
    consumedUnits.length === 0
      ? 0
      : Math.round(
          consumedUnits.reduce((sum, value) => sum + value, 0) /
            consumedUnits.length
        );

  return {
    environment: environment.name,
    total: requests.length,
    simulated,
    failed,
    blocked,
    averageUnitsConsumed,
    minUnitsConsumed:
      consumedUnits.length > 0 ? Math.min(...consumedUnits) : undefined,
    maxUnitsConsumed:
      consumedUnits.length > 0 ? Math.max(...consumedUnits) : undefined,
    delayMs,
    results,
    errors: results.flatMap((result) => result.errors),
    checkedAt: new Date().toISOString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
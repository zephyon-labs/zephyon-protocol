import type { ProtocolEnvironment } from "./config";
import {
  simulatePaymentBatch,
  type BatchPaymentSimulationResult,
} from "./batchPaymentSimulator";
import type { PaymentSimulationRequest } from "./paymentSimulator";

export type PaymentScenario = {
  name: string;
  description: string;
  requests: PaymentSimulationRequest[];
  delayMs: number;
};

export type ScenarioSimulationResult = {
  scenarioName: string;
  description: string;
  result: BatchPaymentSimulationResult;
};

export async function simulateScenario(
  environment: ProtocolEnvironment,
  scenario: PaymentScenario
): Promise<ScenarioSimulationResult> {
  const result = await simulatePaymentBatch(environment, scenario.requests, {
    delayMs: scenario.delayMs,
  });

  return {
    scenarioName: scenario.name,
    description: scenario.description,
    result,
  };
}
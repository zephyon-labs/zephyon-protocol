import { DEFAULT_ENVIRONMENT } from "./config";
import {
  simulatePayment,
  type SimulationRequest,
  type SimulationResult,
} from "./simulation";

export async function runSimulation(
  request: SimulationRequest
): Promise<SimulationResult> {
  return simulatePayment(DEFAULT_ENVIRONMENT, request);
}

export async function runDefaultSimulation(): Promise<SimulationResult> {
  return runSimulation({
    sender: "alice",
    receiver: "bob",
    amountUsd: 25,
  });
}
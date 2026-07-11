// scripts/smoke_test_resilience_engine.ts

import { ResilienceEngine } from "../src/resilience";
import { createRuntimeFailure } from "../src/resilience";

async function main(): Promise<void> {
  console.log("========================================");
  console.log("   ZEPHYON RESILIENCE ENGINE SMOKE TEST");
  console.log("========================================");
  console.log();

  const engine = new ResilienceEngine();

  //
  // Scenario 1
  //

  console.log("Scenario 1: Successful execution");

  const success = await engine.execute({
    correlationId: crypto.randomUUID(),
    stage: "adapter",
    operation: async () => {
      return "Payment Completed";
    },
  });

  console.log(success);
  console.log();

  //
  // Scenario 2
  //

  console.log("Scenario 2: Retryable RPC failure");

  let attempts = 0;

  const retryResult = await engine.execute({
    correlationId: crypto.randomUUID(),
    stage: "adapter",
    operation: async () => {
      attempts++;

      if (attempts < 3) {
        throw createRuntimeFailure({
          code: "RPC_TIMEOUT",
          category: "rpc",
          stage: "adapter",
          message: "RPC timed out.",
        });
      }

      return "Recovered on retry";
    },
  });

  console.log(retryResult);
  console.log();

  //
  // Scenario 3
  //

  console.log("Scenario 3: Compliance rejection");

  const compliance = await engine.execute({
    correlationId: crypto.randomUUID(),
    stage: "compliance",
    operation: async () => {
      throw createRuntimeFailure({
        code: "COMPLIANCE_REJECTED",
        category: "compliance",
        stage: "compliance",
        message: "Compliance denied payment.",
      });
    },
  });

  console.log(compliance);
  console.log();

  //
  // Scenario 4
  //

  console.log("Scenario 4: Timeout");

  const timeout = await engine.execute({
    correlationId: crypto.randomUUID(),
    stage: "adapter",
    operation: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      return "Finished";
    },
  });

  console.log(timeout);
  console.log();

  //
  // Summary
  //

  console.log("========================================");
  console.log("Resilience Engine Smoke Test Complete");
  console.log("========================================");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
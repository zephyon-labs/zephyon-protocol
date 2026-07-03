import {
  bootstrapProtocolLab,
  simulateScenario,
  type PaymentScenario,
}  from "../src/protocolLab";

const MINT = "2w2nqMemQzjwKMk3jEmtXnBqGBXGJLs8FNfb5Khb8E7J";

async function main() {
  const lab = await bootstrapProtocolLab();

  const bob = lab.participants.find((participant) => participant.id === "bob");
  const luna = lab.participants.find((participant) => participant.id === "luna");
  const pixelPizza = lab.participants.find(
    (participant) => participant.id === "pixel-pizza"
  );
  const atlasAi = lab.participants.find(
    (participant) => participant.id === "atlas-ai"
  );

  if (!bob || !luna || !pixelPizza || !atlasAi) {
    throw new Error("Missing one or more required scenario participants.");
  }

  const scenario: PaymentScenario = {
    name: "Mini Economy Relationship Graph",
    description: "Mixed-value payment simulation across multiple economic actors.",
    delayMs: 2000,
    requests: [
      { mint: MINT, recipient: bob.wallet, amountRaw: 1 },
      { mint: MINT, recipient: luna.wallet, amountRaw: 5 },
      { mint: MINT, recipient: pixelPizza.wallet, amountRaw: 10 },
      { mint: MINT, recipient: atlasAi.wallet, amountRaw: 25 },
      { mint: MINT, recipient: bob.wallet, amountRaw: 50 },
      { mint: MINT, recipient: luna.wallet, amountRaw: 100 },
      { mint: MINT, recipient: pixelPizza.wallet, amountRaw: 250 },
      { mint: MINT, recipient: atlasAi.wallet, amountRaw: 500 },
      { mint: MINT, recipient: luna.wallet, amountRaw: 1000 },
      { mint: MINT, recipient: pixelPizza.wallet, amountRaw: 2500 },
    ],
  };

  const simulation = await simulateScenario(lab.environment, scenario);
  const result = simulation.result;

  console.log("");
  console.log("========================================");
  console.log("     ZEPHYON MINI ECONOMY REPORT");
  console.log("========================================");
  console.log("");

  console.log(`Scenario          : ${simulation.scenarioName}`);
  console.log(`Description       : ${simulation.description}`);
  console.log(`Environment       : ${result.environment}`);
  console.log(`Total Payments    : ${result.total}`);
  console.log(`Delay             : ${result.delayMs} ms`);
  console.log(`Successful        : ${result.simulated}`);
  console.log(`Failed            : ${result.failed}`);
  console.log(`Blocked           : ${result.blocked}`);
  console.log(`Avg Compute Units : ${result.averageUnitsConsumed}`);
  console.log(`Min Compute Units : ${result.minUnitsConsumed ?? "N/A"}`);
  console.log(`Max Compute Units : ${result.maxUnitsConsumed ?? "N/A"}`);

  console.log("");
  console.log("========================================");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
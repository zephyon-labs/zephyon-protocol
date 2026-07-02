import {
  DEFAULT_ENVIRONMENT,
  getScenarioParticipant,
  simulateScenario,
  type PaymentScenario,
} from "../src/protocolLab";

const MINT = "2w2nqMemQzjwKMk3jEmtXnBqGBXGJLs8FNfb5Khb8E7J";

const bob = getScenarioParticipant("bob");
const luna = getScenarioParticipant("luna");
const pixelPizza = getScenarioParticipant("pixel-pizza");
const atlasAi = getScenarioParticipant("atlas-ai");

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

async function main() {
  const simulation = await simulateScenario(DEFAULT_ENVIRONMENT, scenario);
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
import { DEFAULT_ENVIRONMENT, simulatePaymentBatch } from "../src/protocolLab";

const MINT = "2w2nqMemQzjwKMk3jEmtXnBqGBXGJLs8FNfb5Khb8E7J";
const RECIPIENT = "DWLaEPUUyLgPqhoJDGni8PRaL58FdfSmXdL6Qtrp1hJ8";

const BATCH_SIZE = 100;
const DELAY_MS = 2000;

async function main() {
  const requests = Array.from({ length: BATCH_SIZE }, () => ({
    mint: MINT,
    recipient: RECIPIENT,
    amountRaw: 1,
  }));

  const result = await simulatePaymentBatch(DEFAULT_ENVIRONMENT, requests, {
    delayMs: DELAY_MS,
  });

  console.log("");
  console.log("========================================");
  console.log("   ZEPHYON BATCH PAYMENT SIMULATION");
  console.log("========================================");
  console.log("");

  console.log(`Environment       : ${result.environment}`);
  console.log(`Total             : ${result.total}`);
  console.log(`Delay             : ${result.delayMs} ms`);
  console.log(`Simulated         : ${result.simulated}`);
  console.log(`Failed            : ${result.failed}`);
  console.log(`Blocked           : ${result.blocked}`);
  console.log(`Avg Compute Units : ${result.averageUnitsConsumed}`);
  console.log(`Min Compute Units : ${result.minUnitsConsumed ?? "N/A"}`);
  console.log(`Max Compute Units : ${result.maxUnitsConsumed ?? "N/A"}`);
  console.log(`Checked At        : ${result.checkedAt}`);

  if (result.errors.length > 0) {
    console.log("");
    console.log("Errors");
    console.log("----------------------------");

    for (const error of result.errors) {
      console.log(`• ${error}`);
    }
  }

  console.log("");
  console.log("========================================");
}

main().catch((error) => {
  console.error("Batch simulation failed:");
  console.error(error);
  process.exit(1);
});
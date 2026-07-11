import { DEFAULT_ENVIRONMENT } from "../src/protocolLab";
import { simulateSplPayment } from "../src/protocolLab";

// Replace these with real values before running.
const MINT = "2w2nqMemQzjwKMk3jEmtXnBqGBXGJLs8FNfb5Khb8E7J";
const RECIPIENT = "DWLaEPUUyLgPqhoJDGni8PRaL58FdfSmXdL6Qtrp1hJ8";

async function main() {
  const result = await simulateSplPayment(
    DEFAULT_ENVIRONMENT,
    {
      mint: MINT,
      recipient: RECIPIENT,
      amountRaw: 1,
    }
  );

  console.log("");
  console.log("========================================");
  console.log("   ZEPHYON PAYMENT SIMULATION");
  console.log("========================================");
  console.log("");

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
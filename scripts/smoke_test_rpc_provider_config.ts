import {
  createConfiguredRpcEndpoints,
  createConfiguredRpcRegistry,
} from "../src/infrastructure";
import {
  getSupportedRpcProviderEnvKeys,
  maskUrl,
} from "../src/config";

function main(): void {
  const configuredEndpoints = createConfiguredRpcEndpoints();
  const registry = createConfiguredRpcRegistry();
  const snapshot = registry.snapshot();

  console.log("========================================");
  console.log("ZEPHYON RPC PROVIDER CONFIG");
  console.log("========================================");
  console.log("");
  console.log(`Configured Premium Endpoints : ${configuredEndpoints.length}`);
  console.log(`Total Registry Endpoints     : ${snapshot.totalEndpoints}`);
  console.log(`Usable Registry Endpoints    : ${snapshot.usableEndpoints}`);
  console.log(`Providers                    : ${snapshot.providers.join(", ")}`);
  console.log("");

  if (configuredEndpoints.length === 0) {
    console.log("No premium provider endpoints loaded.");
    console.log("This is expected until .env contains provider RPC URLs.");
    console.log("");
    console.log("Supported env keys:");

    for (const key of getSupportedRpcProviderEnvKeys()) {
      console.log(`- ${key}`);
    }

    console.log("========================================");
    return;
  }

  console.log("Loaded Premium Endpoints:");
  console.log("----------------------------------------");

  for (const endpoint of configuredEndpoints) {
    console.log(endpoint.name);
    console.log(`  Provider     : ${endpoint.provider}`);
    console.log(`  Network      : ${endpoint.network}`);
    console.log(`  Priority     : ${endpoint.priority}`);
    console.log(`  URL          : ${maskUrl(endpoint.url)}`);
    console.log(`  Enhanced API : ${endpoint.supportsEnhancedApi}`);
    console.log(`  Priority Fee : ${endpoint.supportsPriorityFees}`);
    console.log("");
  }

  console.log("========================================");
}

main();
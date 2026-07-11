import {
  createDefaultRpcRegistry,
  formatInfrastructureValidationReport,
  validateRpcInfrastructure,
} from "../src/infrastructure";

async function main(): Promise<void> {
  const registry = createDefaultRpcRegistry();

  const snapshot = registry.snapshot();

  console.log("========================================");
  console.log("ZEPHYON INFRASTRUCTURE DISCOVERY");
  console.log("========================================");
  console.log("");
  console.log(`Registered Endpoints : ${snapshot.totalEndpoints}`);
  console.log(`Usable Endpoints     : ${snapshot.usableEndpoints}`);
  console.log(`Disabled Endpoints   : ${snapshot.disabledEndpoints}`);
  console.log(`Networks             : ${snapshot.networks.join(", ")}`);
  console.log(`Providers            : ${snapshot.providers.join(", ")}`);
  console.log("");

  const report = await validateRpcInfrastructure(registry, {
    network: "devnet",
    health: {
      timeoutMs: 5_000,
      commitment: "confirmed",
    },
  });

  console.log(formatInfrastructureValidationReport(report));
}

main().catch((error: unknown) => {
  console.error("Infrastructure smoke test failed.");
  console.error(error);
  throw error;
});
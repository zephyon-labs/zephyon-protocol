import { Connection } from "@solana/web3.js";
import { DEFAULT_ENVIRONMENT } from "./config";
import { runRpcDiagnostics } from "./diagnostics";
import { validateProtocolEnvironment } from "./validator";
import { scenarioParticipants } from "./scenarioParticipants";

export type ProtocolLabBootstrap = {
  environment: typeof DEFAULT_ENVIRONMENT;
  connection: Connection;
  diagnostics: Awaited<ReturnType<typeof runRpcDiagnostics>>;
  validation: Awaited<ReturnType<typeof validateProtocolEnvironment>>;
  participants: typeof scenarioParticipants;
};

export async function bootstrapProtocolLab(): Promise<ProtocolLabBootstrap> {
  console.log("");
  console.log("========================================");
  console.log("        ZEPHYON PROTOCOL LAB");
  console.log("========================================");
  console.log("");
  console.log("Bootstrapping protocol environment...");

  const environment = DEFAULT_ENVIRONMENT;
  const connection = new Connection(environment.rpcEndpoint.url, "confirmed");

  const diagnostics = await runRpcDiagnostics();
  const validation = await validateProtocolEnvironment(environment);

  console.log("");
  console.log("Bootstrap complete.");
  console.log("Protocol Lab runtime is ready.");
  console.log("");

  return {
    environment,
    connection,
    diagnostics,
    validation,
    participants: scenarioParticipants,
  };
}
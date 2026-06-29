import { Connection } from "@solana/web3.js";
import { RpcEndpointConfig } from "./rpc";

export type RpcHealthStatus = "healthy" | "degraded" | "unreachable";

export type RpcHealthResult = {
  label: string;
  environment: string;
  url: string;
  status: RpcHealthStatus;
  healthy: boolean;
  slot?: number;
  blockHeight?: number;
  latestBlockhashAvailable: boolean;
  version?: string;
  latencyMs: number;
  errors: string[];
  checkedAt: string;
};

export async function checkRpcHealth(
  endpoint: RpcEndpointConfig
): Promise<RpcHealthResult> {
  const startedAt = Date.now();
  const connection = new Connection(endpoint.url, "confirmed");
  const errors: string[] = [];

  let slot: number | undefined;
  let blockHeight: number | undefined;
  let latestBlockhashAvailable = false;
  let version: string | undefined;

  try {
    slot = await connection.getSlot();
  } catch (error) {
    errors.push(`getSlot failed: ${formatError(error)}`);
  }

  try {
    blockHeight = await connection.getBlockHeight();
  } catch (error) {
    errors.push(`getBlockHeight failed: ${formatError(error)}`);
  }

  try {
    const latestBlockhash = await connection.getLatestBlockhash();
    latestBlockhashAvailable = Boolean(latestBlockhash.blockhash);
  } catch (error) {
    errors.push(`getLatestBlockhash failed: ${formatError(error)}`);
  }

  try {
    const nodeVersion = await connection.getVersion();
    version = nodeVersion["solana-core"];
  } catch (error) {
    errors.push(`getVersion failed: ${formatError(error)}`);
  }

  const status = determineStatus(errors, latestBlockhashAvailable);

  return {
    label: endpoint.label,
    environment: endpoint.environment,
    url: endpoint.url,
    status,
    healthy: status === "healthy",
    slot,
    blockHeight,
    latestBlockhashAvailable,
    version,
    latencyMs: Date.now() - startedAt,
    errors,
    checkedAt: new Date().toISOString(),
  };
}

function determineStatus(
  errors: string[],
  latestBlockhashAvailable: boolean
): RpcHealthStatus {
  if (errors.length >= 3) {
    return "unreachable";
  }

  if (errors.length > 0 || !latestBlockhashAvailable) {
    return "degraded";
  }

  return "healthy";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
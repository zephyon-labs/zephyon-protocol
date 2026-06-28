import { Connection } from "@solana/web3.js";
import { RpcEndpointConfig } from "./rpc";

export type RpcHealthResult = {
  label: string;
  environment: string;
  url: string;
  healthy: boolean;
  slot?: number;
  blockHeight?: number;
  latencyMs: number;
  error?: string;
  checkedAt: string;
};

export async function checkRpcHealth(
  endpoint: RpcEndpointConfig
): Promise<RpcHealthResult> {
  const startedAt = Date.now();
  const connection = new Connection(endpoint.url, "confirmed");

  try {
    const [slot, blockHeight] = await Promise.all([
      connection.getSlot(),
      connection.getBlockHeight(),
    ]);

    return {
      label: endpoint.label,
      environment: endpoint.environment,
      url: endpoint.url,
      healthy: true,
      slot,
      blockHeight,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      label: endpoint.label,
      environment: endpoint.environment,
      url: endpoint.url,
      healthy: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString(),
    };
  }
}
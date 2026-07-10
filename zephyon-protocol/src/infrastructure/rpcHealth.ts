import { Connection } from "@solana/web3.js";
import type { RpcEndpoint } from "./rpcEndpoint";

export type RpcHealthStatus =
  | "healthy"
  | "degraded"
  | "unhealthy"
  | "unknown";

export type RpcHealthCheckOptions = {
  timeoutMs?: number;
  commitment?: "processed" | "confirmed" | "finalized";
};

export type RpcHealthResult = {
  endpointId: string;
  endpointName: string;
  provider: string;
  network: string;
  url: string;
  status: RpcHealthStatus;
  reachable: boolean;
  latencyMs: number | null;
  slot: number | null;
  blockHeight: number | null;
  checkedAt: string;
  error?: {
    name: string;
    message: string;
  };
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`RPC health check timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

export async function checkRpcHealth(
  endpoint: RpcEndpoint,
  options: RpcHealthCheckOptions = {},
): Promise<RpcHealthResult> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const commitment = options.commitment ?? "confirmed";
  const startedAt = Date.now();

  try {
    const connection = new Connection(endpoint.url, commitment);

    const [slot, blockHeight] = await withTimeout(
      Promise.all([
        connection.getSlot(commitment),
        connection.getBlockHeight(commitment),
      ]),
      timeoutMs,
    );

    const latencyMs = Date.now() - startedAt;

    return {
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      provider: endpoint.provider,
      network: endpoint.network,
      url: endpoint.url,
      status: latencyMs <= 750 ? "healthy" : "degraded",
      reachable: true,
      latencyMs,
      slot,
      blockHeight,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    return {
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      provider: endpoint.provider,
      network: endpoint.network,
      url: endpoint.url,
      status: "unhealthy",
      reachable: false,
      latencyMs: null,
      slot: null,
      blockHeight: null,
      checkedAt: new Date().toISOString(),
      error: {
        name: err.name,
        message: err.message,
      },
    };
  }
}

export async function checkManyRpcEndpoints(
  endpoints: RpcEndpoint[],
  options: RpcHealthCheckOptions = {},
): Promise<RpcHealthResult[]> {
  return Promise.all(endpoints.map((endpoint) => checkRpcHealth(endpoint, options)));
}
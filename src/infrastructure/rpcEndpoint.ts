export type RpcNetwork = "devnet" | "testnet" | "mainnet-beta" | "localnet";

export type RpcProvider =
  | "solana-public"
  | "helius"
  | "quicknode"
  | "triton"
  | "alchemy"
  | "anza"
  | "local"
  | "custom";

export type RpcEndpointStatus =
  | "active"
  | "disabled"
  | "degraded"
  | "maintenance";

export type RpcEndpointId = string;

export type RpcEndpoint = {
  id: RpcEndpointId;
  name: string;
  provider: RpcProvider;
  network: RpcNetwork;
  url: string;
  status: RpcEndpointStatus;
  priority: number;
  supportsWebsocket?: boolean;
  supportsPriorityFees?: boolean;
  supportsEnhancedApi?: boolean;
  metadata?: Record<string, unknown>;
};

export function createRpcEndpoint(endpoint: RpcEndpoint): RpcEndpoint {
  if (!endpoint.id.trim()) throw new Error("RPC endpoint id is required.");
  if (!endpoint.name.trim()) throw new Error("RPC endpoint name is required.");
  if (!endpoint.url.trim()) throw new Error("RPC endpoint url is required.");

  if (!endpoint.url.startsWith("http://") && !endpoint.url.startsWith("https://")) {
    throw new Error(`Invalid RPC endpoint URL: ${endpoint.url}`);
  }

  if (!Number.isFinite(endpoint.priority)) {
    throw new Error("RPC endpoint priority must be a finite number.");
  }

  return {
    ...endpoint,
    supportsWebsocket: endpoint.supportsWebsocket ?? false,
    supportsPriorityFees: endpoint.supportsPriorityFees ?? false,
    supportsEnhancedApi: endpoint.supportsEnhancedApi ?? false,
    metadata: endpoint.metadata ?? {},
  };
}

export function isRpcEndpointUsable(endpoint: RpcEndpoint): boolean {
  return endpoint.status === "active" || endpoint.status === "degraded";
}
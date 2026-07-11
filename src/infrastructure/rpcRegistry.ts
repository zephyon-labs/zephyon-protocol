import {
  createRpcEndpoint,
  isRpcEndpointUsable,
  type RpcEndpoint,
  type RpcEndpointId,
  type RpcNetwork,
} from "./rpcEndpoint";
import { createConfiguredRpcEndpoints } from "./rpcProviderConfig";

export type RpcRegistrySnapshot = {
  totalEndpoints: number;
  usableEndpoints: number;
  disabledEndpoints: number;
  networks: RpcNetwork[];
  providers: string[];
};

export class RpcRegistry {
  private readonly endpoints = new Map<RpcEndpointId, RpcEndpoint>();

  constructor(initialEndpoints: RpcEndpoint[] = []) {
    for (const endpoint of initialEndpoints) {
      this.register(endpoint);
    }
  }

  register(endpoint: RpcEndpoint): RpcEndpoint {
    const normalized = createRpcEndpoint(endpoint);

    if (this.endpoints.has(normalized.id)) {
      throw new Error(`RPC endpoint already registered: ${normalized.id}`);
    }

    this.endpoints.set(normalized.id, normalized);
    return normalized;
  }

  upsert(endpoint: RpcEndpoint): RpcEndpoint {
    const normalized = createRpcEndpoint(endpoint);
    this.endpoints.set(normalized.id, normalized);
    return normalized;
  }

  get(endpointId: RpcEndpointId): RpcEndpoint | undefined {
    return this.endpoints.get(endpointId);
  }

  list(): RpcEndpoint[] {
    return [...this.endpoints.values()].sort((a, b) => a.priority - b.priority);
  }

  listByNetwork(network: RpcNetwork): RpcEndpoint[] {
    return this.list().filter((endpoint) => endpoint.network === network);
  }

  listUsable(network?: RpcNetwork): RpcEndpoint[] {
    return this.list().filter((endpoint) => {
      const networkMatches = network ? endpoint.network === network : true;
      return networkMatches && isRpcEndpointUsable(endpoint);
    });
  }

  remove(endpointId: RpcEndpointId): boolean {
    return this.endpoints.delete(endpointId);
  }

  snapshot(): RpcRegistrySnapshot {
    const all = this.list();

    return {
      totalEndpoints: all.length,
      usableEndpoints: all.filter(isRpcEndpointUsable).length,
      disabledEndpoints: all.filter((endpoint) => endpoint.status === "disabled").length,
      networks: [...new Set(all.map((endpoint) => endpoint.network))],
      providers: [...new Set(all.map((endpoint) => endpoint.provider))],
    };
  }
}

export function createDefaultRpcRegistry(): RpcRegistry {
  return new RpcRegistry([
    {
      id: "solana-devnet-public",
      name: "Solana Devnet Public RPC",
      provider: "solana-public",
      network: "devnet",
      url: "https://api.devnet.solana.com",
      status: "active",
      priority: 10,
      supportsWebsocket: true,
      supportsPriorityFees: false,
      supportsEnhancedApi: false,
      metadata: {
        source: "default",
        purpose: "development-validation",
      },
    },
    {
      id: "solana-testnet-public",
      name: "Solana Testnet Public RPC",
      provider: "solana-public",
      network: "testnet",
      url: "https://api.testnet.solana.com",
      status: "active",
      priority: 20,
      supportsWebsocket: true,
      supportsPriorityFees: false,
      supportsEnhancedApi: false,
      metadata: {
        source: "default",
        purpose: "protocol-upgrade-validation",
      },
    },
    {
      id: "solana-mainnet-public",
      name: "Solana Mainnet Public RPC",
      provider: "solana-public",
      network: "mainnet-beta",
      url: "https://api.mainnet-beta.solana.com",
      status: "active",
      priority: 30,
      supportsWebsocket: true,
      supportsPriorityFees: true,
      supportsEnhancedApi: false,
      metadata: {
        source: "default",
        purpose: "mainnet-readiness-reference",
      },
    },
  ]);
}

export function createConfiguredRpcRegistry(): RpcRegistry {
  const registry = createDefaultRpcRegistry();

  for (const endpoint of createConfiguredRpcEndpoints()) {
    registry.upsert(endpoint);
  }

  return registry;
}
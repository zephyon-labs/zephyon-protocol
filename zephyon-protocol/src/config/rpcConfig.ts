import { getEnv } from "./environment";
import type { RpcEndpoint, RpcNetwork, RpcProvider } from "../infrastructure/rpcEndpoint";

type RpcProviderEnvConfig = {
  envKey: string;
  id: string;
  name: string;
  provider: RpcProvider;
  network: RpcNetwork;
  priority: number;
  supportsPriorityFees?: boolean;
  supportsEnhancedApi?: boolean;
};

const RPC_PROVIDER_ENV_CONFIGS: RpcProviderEnvConfig[] = [
  {
    envKey: "HELIUS_DEVNET_RPC_URL",
    id: "helius-devnet",
    name: "Helius Devnet RPC",
    provider: "helius",
    network: "devnet",
    priority: 5,
    supportsPriorityFees: true,
    supportsEnhancedApi: true,
  },
  {
    envKey: "HELIUS_MAINNET_RPC_URL",
    id: "helius-mainnet",
    name: "Helius Mainnet RPC",
    provider: "helius",
    network: "mainnet-beta",
    priority: 5,
    supportsPriorityFees: true,
    supportsEnhancedApi: true,
  },
  {
    envKey: "QUICKNODE_DEVNET_RPC_URL",
    id: "quicknode-devnet",
    name: "QuickNode Devnet RPC",
    provider: "quicknode",
    network: "devnet",
    priority: 6,
    supportsPriorityFees: true,
    supportsEnhancedApi: true,
  },
  {
    envKey: "QUICKNODE_MAINNET_RPC_URL",
    id: "quicknode-mainnet",
    name: "QuickNode Mainnet RPC",
    provider: "quicknode",
    network: "mainnet-beta",
    priority: 6,
    supportsPriorityFees: true,
    supportsEnhancedApi: true,
  },
  {
    envKey: "TRITON_MAINNET_RPC_URL",
    id: "triton-mainnet",
    name: "Triton Mainnet RPC",
    provider: "triton",
    network: "mainnet-beta",
    priority: 7,
    supportsPriorityFees: true,
    supportsEnhancedApi: false,
  },
];

export function getConfiguredRpcEndpoints(): RpcEndpoint[] {
  return RPC_PROVIDER_ENV_CONFIGS.flatMap((config): RpcEndpoint[] => {
    const url = getEnv(config.envKey);

    if (!url) return [];

    return [
      {
        id: config.id,
        name: config.name,
        provider: config.provider,
        network: config.network,
        url,
        status: "active",
        priority: config.priority,
        supportsWebsocket: false,
        supportsPriorityFees: config.supportsPriorityFees ?? false,
        supportsEnhancedApi: config.supportsEnhancedApi ?? false,
        metadata: {
          source: "environment",
          envKey: config.envKey,
        },
      },
    ];
  });
}

export function getSupportedRpcProviderEnvKeys(): string[] {
  return RPC_PROVIDER_ENV_CONFIGS.map((config) => config.envKey);
}
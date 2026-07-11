import { rpcEndpoints, RpcEndpointConfig } from "./rpc";
import type { SolanaCluster } from "../shared";

export type ProtocolEnvironment = {
  name: string;
  cluster: SolanaCluster;
  rpcEndpoint: RpcEndpointConfig;
  programId: string;
  treasuryPda?: string;
};

export const DEVNET_ENVIRONMENT: ProtocolEnvironment = {
  name: "Zephyon Devnet",
  cluster: "devnet",
  rpcEndpoint: rpcEndpoints.find(
    (endpoint) => endpoint.environment === "devnet"
  )!,
  programId: "BtP7rVw9sqN4pW5RuzZJ2c4576R5pJU9yRtjrRJ7b5bM",
  treasuryPda: "CuqGCfnkHN5APYdL2UkCMYbVxXxqKrwrmWXw24WeQDbE",
};

export const TESTNET_ENVIRONMENT: ProtocolEnvironment = {
  name: "Zephyon Testnet",
  cluster: "testnet",
  rpcEndpoint: rpcEndpoints.find(
    (endpoint) => endpoint.environment === "testnet"
  )!,
  programId: "",
};

export const MAINNET_ENVIRONMENT: ProtocolEnvironment = {
  name: "Zephyon Mainnet",
  cluster: "mainnet-beta",
  rpcEndpoint: rpcEndpoints.find(
    (endpoint) => endpoint.environment === "mainnet-beta"
  )!,
  programId: "",
};

export const DEFAULT_ENVIRONMENT = DEVNET_ENVIRONMENT;
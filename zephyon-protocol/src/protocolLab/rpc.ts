export type RpcEnvironment = "devnet" | "testnet" | "mainnet-beta" | "custom";

export type RpcEndpointConfig = {
  environment: RpcEnvironment;
  url: string;
  label: string;
};

export const defaultRpcEndpoints: RpcEndpointConfig[] = [
  {
    environment: "devnet",
    url: "https://api.devnet.solana.com",
    label: "Solana Devnet Public RPC",
  },
  {
    environment: "testnet",
    url: "https://api.testnet.solana.com",
    label: "Solana Testnet Public RPC",
  },
  {
    environment: "mainnet-beta",
    url: "https://api.mainnet-beta.solana.com",
    label: "Solana Mainnet Public RPC",
  },
];
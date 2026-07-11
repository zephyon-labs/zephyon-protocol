import { InMemoryPaymentAdapterRegistry } from "../shared/paymentAdapterRegistry";
import { SolanaPaymentAdapter } from "./solana/SolanaPaymentAdapter";
import type { BlockchainNetwork } from "../shared/blockchain";

export type CreateDefaultAdapterRegistryConfig = {
  solana: {
    network: BlockchainNetwork;

    executeTransfer: ConstructorParameters<
      typeof SolanaPaymentAdapter
    >[0]["executeTransfer"];

    confirmTransfer: ConstructorParameters<
      typeof SolanaPaymentAdapter
    >[0]["confirmTransfer"];

    estimateFeeAmount?: ConstructorParameters<
      typeof SolanaPaymentAdapter
    >[0]["estimateFeeAmount"];

    checkStatus?: ConstructorParameters<
      typeof SolanaPaymentAdapter
    >[0]["checkStatus"];
  };
};

export function createDefaultAdapterRegistry(
  config: CreateDefaultAdapterRegistryConfig
): InMemoryPaymentAdapterRegistry {
  const registry = new InMemoryPaymentAdapterRegistry();

  registry.register(
    new SolanaPaymentAdapter({
      network: config.solana.network,
      executeTransfer: config.solana.executeTransfer,
      confirmTransfer: config.solana.confirmTransfer,
      estimateFeeAmount: config.solana.estimateFeeAmount,
      checkStatus: config.solana.checkStatus,
    })
  );

  return registry;
}
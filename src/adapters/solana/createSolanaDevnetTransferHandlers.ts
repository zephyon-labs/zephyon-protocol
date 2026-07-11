import { Connection } from "@solana/web3.js";
import type {
  SolanaSettlementResult,
  SolanaTransferRequest,
  SolanaTransferResult,
} from "./SolanaPaymentAdapter";
import type { ProtocolEnvironment } from "../../protocolLab/config";
import { executeZephyonDevnetSplPay } from "./executeZephyonDevnetSplPay";

export type SolanaDevnetTransferHandlersConfig = {
  environment: ProtocolEnvironment;
};

export function createSolanaDevnetTransferHandlers(
  config: SolanaDevnetTransferHandlersConfig,
): {
  executeTransfer: (
    request: SolanaTransferRequest,
  ) => Promise<SolanaTransferResult>;
  confirmTransfer: (
    request: SolanaTransferRequest & { signature: string },
  ) => Promise<SolanaSettlementResult>;
} {
  const connection = new Connection(
    config.environment.rpcEndpoint.url,
    "confirmed",
  );

  return {
    async executeTransfer(request) {
      return executeZephyonDevnetSplPay(request, {
        rpcUrl: config.environment.rpcEndpoint.url,
      });
    },

    async confirmTransfer(request) {
      const status = await connection.getSignatureStatus(request.signature, {
        searchTransactionHistory: true,
      });

      if (!status.value) {
        throw new Error(`No Solana signature status found: ${request.signature}`);
      }

      if (status.value.err) {
        throw new Error(
          `Solana transaction failed: ${JSON.stringify(status.value.err)}`,
        );
      }

      return {
        signature: request.signature,
        settledAt: new Date().toISOString(),
        slot: status.value.slot,
        confirmationCount:
          status.value.confirmationStatus === "finalized"
            ? 32
            : status.value.confirmationStatus === "confirmed"
              ? 1
              : 0,
      };
    },
  };
}
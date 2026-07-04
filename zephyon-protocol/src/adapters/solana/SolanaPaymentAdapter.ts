import type {
  PaymentAdapterExecutionResult,
  PaymentAdapterHealth,
  PaymentAdapterSettlementResult,
  PaymentFeeEstimate,
  PaymentRailAdapter,
} from "../../shared/paymentAdapter";
import type { PaymentIntent } from "../../shared/paymentIntent";
import type {
  BlockchainSettlementDetails,
  PaymentTransaction,
} from "../../shared/paymentTransaction";
import type { IsoTimestamp } from "../../shared/time";

export type SolanaAdapterStatus = "available" | "degraded" | "unavailable";

export type SolanaTransferRequest = {
  intent: PaymentIntent;
  transaction: PaymentTransaction;
};

export type SolanaTransferResult = {
  signature: string;
  submittedAt: IsoTimestamp;
  slot?: number;
  blockhash?: string;
};

export type SolanaSettlementResult = {
  signature: string;
  settledAt: IsoTimestamp;
  slot?: number;
  confirmationCount?: number;
};

export type SolanaPaymentAdapterConfig = {
  network: BlockchainSettlementDetails["network"];

  estimateFeeAmount?: (
    request: SolanaTransferRequest
  ) => number | Promise<number>;

  executeTransfer: (
    request: SolanaTransferRequest
  ) => SolanaTransferResult | Promise<SolanaTransferResult>;

  confirmTransfer: (
    request: SolanaTransferRequest & {
      signature: string;
    }
  ) => SolanaSettlementResult | Promise<SolanaSettlementResult>;

  checkStatus?: () =>
    | {
        status: SolanaAdapterStatus;
        message?: string;
      }
    | Promise<{
        status: SolanaAdapterStatus;
        message?: string;
      }>;

  clock?: () => IsoTimestamp;
};

export class SolanaPaymentAdapter implements PaymentRailAdapter {
  readonly rail = "solana" as const;

  private readonly config: SolanaPaymentAdapterConfig;

  constructor(config: SolanaPaymentAdapterConfig) {
    this.config = config;
  }

  async checkHealth(): Promise<PaymentAdapterHealth> {
    const now = this.now();

    if (!this.config.checkStatus) {
      return {
        rail: this.rail,
        status: "available",
        checkedAt: now,
        message: "Solana adapter initialized.",
      };
    }

    const status = await this.config.checkStatus();

    return {
      rail: this.rail,
      status: status.status,
      checkedAt: now,
      message: status.message,
    };
  }

  async estimateFees(
    intent: PaymentIntent,
    transaction: PaymentTransaction
  ): Promise<PaymentFeeEstimate> {
    const estimatedFeeAmount = this.config.estimateFeeAmount
      ? await this.config.estimateFeeAmount({ intent, transaction })
      : 0;

    return {
      rail: this.rail,
      estimatedFeeAmount,
      currency: "SOL",
      estimatedAt: this.now(),
    };
  }

  async execute(
    intent: PaymentIntent,
    transaction: PaymentTransaction
  ): Promise<PaymentAdapterExecutionResult> {
    const transfer = await this.config.executeTransfer({
      intent,
      transaction,
    });

    return {
      submittedAt: transfer.submittedAt,
      externalReference: transfer.signature,
      blockchain: {
        network: this.config.network,
        signature: transfer.signature,
        slot: transfer.slot,
        blockhash: transfer.blockhash,
        confirmationCount: 0,
      },
    };
  }

  async monitorSettlement(
    intent: PaymentIntent,
    transaction: PaymentTransaction
  ): Promise<PaymentAdapterSettlementResult> {
    const signature = transaction.blockchain?.signature;

    if (!signature) {
      throw new Error(
        "Cannot monitor Solana settlement without a transaction signature."
      );
    }

    const settlement = await this.config.confirmTransfer({
      intent,
      transaction,
      signature,
    });

    return {
      settledAt: settlement.settledAt,
      externalReference: settlement.signature,
      blockchain: {
        network: this.config.network,
        signature: settlement.signature,
        slot: settlement.slot,
        confirmationCount: settlement.confirmationCount,
      },
    };
  }

  private now(): IsoTimestamp {
    return this.config.clock ? this.config.clock() : new Date().toISOString();
  }
}
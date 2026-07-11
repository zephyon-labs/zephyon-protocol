import type { PaymentIntent } from "./paymentIntent";
import type {
  BlockchainSettlementDetails,
  PaymentTransaction,
} from "./paymentTransaction";
import type { PaymentRail } from "./paymentRail";
import type { IsoTimestamp } from "./time";

export type PaymentAdapterStatus =
  | "available"
  | "degraded"
  | "unavailable";

export type PaymentAdapterHealth = {
  rail: PaymentRail;
  status: PaymentAdapterStatus;
  checkedAt: IsoTimestamp;
  message?: string;
};

export type PaymentFeeEstimate = {
  rail: PaymentRail;
  estimatedFeeAmount: number;
  currency: string;
  estimatedAt: IsoTimestamp;
};

export type PaymentAdapterExecutionResult = {
  submittedAt: IsoTimestamp;
  externalReference?: string;
  blockchain?: BlockchainSettlementDetails;
};

export type PaymentAdapterSettlementResult = {
  settledAt: IsoTimestamp;
  externalReference?: string;
  blockchain?: BlockchainSettlementDetails;
};

export type PaymentAdapterCancelResult = {
  cancelledAt: IsoTimestamp;
  reason?: string;
};

export type PaymentAdapterRefundResult = {
  refundedAt: IsoTimestamp;
  refundReference?: string;
};

export type PaymentRailAdapter = {
  rail: PaymentRail;

  checkHealth(): PaymentAdapterHealth | Promise<PaymentAdapterHealth>;

  estimateFees(
    intent: PaymentIntent,
    transaction: PaymentTransaction
  ): PaymentFeeEstimate | Promise<PaymentFeeEstimate>;

  execute(
    intent: PaymentIntent,
    transaction: PaymentTransaction
  ): PaymentAdapterExecutionResult | Promise<PaymentAdapterExecutionResult>;

  monitorSettlement(
    intent: PaymentIntent,
    transaction: PaymentTransaction
  ):
    | PaymentAdapterSettlementResult
    | Promise<PaymentAdapterSettlementResult>;

  cancel?(
    intent: PaymentIntent,
    transaction: PaymentTransaction
  ): PaymentAdapterCancelResult | Promise<PaymentAdapterCancelResult>;

  refund?(
    intent: PaymentIntent,
    transaction: PaymentTransaction
  ): PaymentAdapterRefundResult | Promise<PaymentAdapterRefundResult>;
};
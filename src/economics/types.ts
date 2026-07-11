export type EconomicEventType =
  | "P2P_PAYMENT_COMPLETED"
  | "MERCHANT_PAYMENT_COMPLETED"
  | "AGENT_PAYMENT_COMPLETED"
  | "SUBSCRIPTION_PURCHASED"
  | "STAKE_CREATED"
  | "STAKE_REMOVED";

export type RevenueBucket =
  | "treasuryOperations"
  | "ecosystemExpansion"
  | "strategicReserve"
  | "buybackAndBurn"
  | "buildersAndContributors";

export type PaymentEvent = {
  type: EconomicEventType;
  amountUsd: number;
  protocolFeeRate: number;
  timestamp: string;
  sender?: string;
  receiver?: string;
  receiptId?: string;
  signature?: string;
};

export type FeeResult = {
  amountUsd: number;
  protocolFeeUsd: number;
  netAmountUsd: number;
  protocolFeeRate: number;
};

export type RevenueAllocation = Record<RevenueBucket, number>;

export type EconomicResult = {
  event: PaymentEvent;
  fee: FeeResult;
  allocation: RevenueAllocation;
};
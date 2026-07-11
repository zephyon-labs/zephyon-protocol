import type { BlockchainNetwork } from "./blockchain";
import type { PaymentIntent } from "./paymentIntent";
import type { PaymentRail } from "./paymentRail";
import type { IsoTimestamp } from "./time";

export type PaymentTransactionId = string;
export type PaymentIntentId = PaymentIntent["id"];
export type PaymentTransactionCurrency = string;

export type PaymentTransactionStatus =
  | "created"
  | "validating"
  | "ready"
  | "processing"
  | "awaiting_settlement"
  | "settled"
  | "completed"
  | "failed"
  | "retrying"
  | "cancelled";

export type PaymentTransactionFailure = {
  code: string;
  reason: string;
  recoverable: boolean;
};

export type BlockchainSettlementDetails = {
  network: BlockchainNetwork;
  signature?: string;
  slot?: number;
  blockhash?: string;
  confirmationCount?: number;
};

export type PaymentTransactionMetadata = {
  memo?: string;
  reference?: string;
  merchantId?: string;
  creatorId?: string;
  agentId?: string;
  invoiceId?: string;
  campaignId?: string;
};

export type PaymentTransaction = {
  id: PaymentTransactionId;
  intentId: PaymentIntentId;

  status: PaymentTransactionStatus;
  rail: PaymentRail;

  amount: number;
  currency: PaymentTransactionCurrency;

  protocolFeeAmount?: number;
  railFeeAmount?: number;
  netAmount?: number;

  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;

  submittedAt?: IsoTimestamp;
  settledAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  cancelledAt?: IsoTimestamp;
  failedAt?: IsoTimestamp;

  blockchain?: BlockchainSettlementDetails;

  failure?: PaymentTransactionFailure;

  metadata?: PaymentTransactionMetadata;
};

export function createPaymentTransaction(params: {
  id: PaymentTransactionId;
  intentId: PaymentIntentId;
  rail: PaymentRail;
  amount: number;
  currency: PaymentTransactionCurrency;
  createdAt: IsoTimestamp;
  metadata?: PaymentTransactionMetadata;
}): PaymentTransaction {
  return {
    id: params.id,
    intentId: params.intentId,
    status: "created",
    rail: params.rail,
    amount: params.amount,
    currency: params.currency,
    createdAt: params.createdAt,
    updatedAt: params.createdAt,
    metadata: params.metadata,
  };
}

export function markTransactionValidating(
  transaction: PaymentTransaction,
  updatedAt: IsoTimestamp
): PaymentTransaction {
  return {
    ...transaction,
    status: "validating",
    updatedAt,
  };
}

export function markTransactionReady(
  transaction: PaymentTransaction,
  updatedAt: IsoTimestamp
): PaymentTransaction {
  return {
    ...transaction,
    status: "ready",
    updatedAt,
  };
}

export function markTransactionProcessing(
  transaction: PaymentTransaction,
  updatedAt: IsoTimestamp,
  submittedAt: IsoTimestamp = updatedAt
): PaymentTransaction {
  return {
    ...transaction,
    status: "processing",
    updatedAt,
    submittedAt,
  };
}

export function markTransactionAwaitingSettlement(
  transaction: PaymentTransaction,
  updatedAt: IsoTimestamp,
  blockchain?: BlockchainSettlementDetails
): PaymentTransaction {
  return {
    ...transaction,
    status: "awaiting_settlement",
    updatedAt,
    blockchain: blockchain ?? transaction.blockchain,
  };
}

export function markTransactionSettled(
  transaction: PaymentTransaction,
  updatedAt: IsoTimestamp,
  settledAt: IsoTimestamp = updatedAt,
  blockchain?: BlockchainSettlementDetails
): PaymentTransaction {
  return {
    ...transaction,
    status: "settled",
    updatedAt,
    settledAt,
    blockchain: blockchain ?? transaction.blockchain,
  };
}

export function markTransactionCompleted(
  transaction: PaymentTransaction,
  updatedAt: IsoTimestamp,
  completedAt: IsoTimestamp = updatedAt
): PaymentTransaction {
  return {
    ...transaction,
    status: "completed",
    updatedAt,
    completedAt,
  };
}

export function markTransactionFailed(
  transaction: PaymentTransaction,
  updatedAt: IsoTimestamp,
  failure: PaymentTransactionFailure,
  failedAt: IsoTimestamp = updatedAt
): PaymentTransaction {
  return {
    ...transaction,
    status: "failed",
    updatedAt,
    failedAt,
    failure,
  };
}

export function markTransactionRetrying(
  transaction: PaymentTransaction,
  updatedAt: IsoTimestamp
): PaymentTransaction {
  return {
    ...transaction,
    status: "retrying",
    updatedAt,
  };
}

export function markTransactionCancelled(
  transaction: PaymentTransaction,
  updatedAt: IsoTimestamp,
  cancelledAt: IsoTimestamp = updatedAt
): PaymentTransaction {
  return {
    ...transaction,
    status: "cancelled",
    updatedAt,
    cancelledAt,
  };
}

export function isTerminalTransactionStatus(
  status: PaymentTransactionStatus
): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function isSuccessfulTransaction(
  transaction: PaymentTransaction
): boolean {
  return transaction.status === "completed" || transaction.status === "settled";
}

export function isFailedTransaction(transaction: PaymentTransaction): boolean {
  return transaction.status === "failed";
}
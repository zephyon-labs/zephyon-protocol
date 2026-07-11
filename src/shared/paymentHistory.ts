import type { PaymentIntentId } from "./paymentTransaction";
import type { PaymentReceipt } from "./paymentReceipt";
import type {
  PaymentTransaction,
  PaymentTransactionId,
} from "./paymentTransaction";
import type { IsoTimestamp } from "./time";

export type PaymentHistoryEntryId = string;

export type PaymentHistoryDirection =
  | "sent"
  | "received"
  | "internal";

export type PaymentHistoryEntry = {
  id: PaymentHistoryEntryId;

  intentId: PaymentIntentId;

  transactionId: PaymentTransactionId;

  receiptId?: PaymentReceipt["id"];

  direction: PaymentHistoryDirection;

  title: string;

  subtitle?: string;

  amount: number;

  currency: string;

  status: PaymentTransaction["status"];

  createdAt: IsoTimestamp;

  settledAt?: IsoTimestamp;
};

export function createHistoryEntry(params: {
  id: PaymentHistoryEntryId;

  intentId: PaymentIntentId;

  transaction: PaymentTransaction;

  receipt?: PaymentReceipt;

  direction: PaymentHistoryDirection;

  title: string;

  subtitle?: string;
}): PaymentHistoryEntry {
  return {
    id: params.id,

    intentId: params.intentId,

    transactionId: params.transaction.id,

    receiptId: params.receipt?.id,

    direction: params.direction,

    title: params.title,

    subtitle: params.subtitle,

    amount: params.transaction.amount,

    currency: params.transaction.currency,

    status: params.transaction.status,

    createdAt: params.transaction.createdAt,

    settledAt: params.transaction.settledAt,
  };
}
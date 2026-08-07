import type { PaymentRail } from "../shared/paymentRail";
import type { ExactAmount } from "./exactValues";
import type { CanonicalPaymentIntentId, ExecutionId, ProviderReference, TransactionId } from "./identifiers";
import type { RailEvidence } from "./railEvidence";

export type RuntimeReceipt<E extends RailEvidence = RailEvidence> = Readonly<{
  schemaVersion: 1;
  receiptId: string;
  paymentIntentId: CanonicalPaymentIntentId;
  executionId: ExecutionId;
  transactionId: TransactionId;
  rail: PaymentRail;
  amount: ExactAmount;
  senderId: string;
  recipientId: string;
  settledAt: string;
  providerReference?: ProviderReference;
  evidence: E;
  createdAt: string;
}>;

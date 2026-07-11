import type { IsoTimestamp } from "../shared/time";
import type { PaymentRail } from "../shared/paymentRail";

export type SettlementStatus =
  | "pending"
  | "submitted"
  | "confirming"
  | "settled"
  | "failed"
  | "reversed";

export type SettlementState = {
  id: string;
  paymentTransactionId: string;
  rail: PaymentRail;
  status: SettlementStatus;
  externalReference?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  settledAt?: IsoTimestamp;
  failureReason?: string;
};
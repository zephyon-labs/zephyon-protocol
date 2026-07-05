import type { PaymentRail } from "../shared/paymentRail";

export type SettlementSpeed =
  | "instant"
  | "same_day"
  | "standard"
  | "delayed";

export type SettlementPolicy = {
  rail: PaymentRail;
  speed: SettlementSpeed;
  requiresConfirmation: boolean;
  supportsReversal: boolean;
  maxRetryAttempts: number;
};
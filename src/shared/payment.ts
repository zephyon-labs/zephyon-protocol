import type { PaymentRail } from "./paymentRail";

export type PaymentMethodType =
  | "wallet"
  | "bank"
  | "card"
  | "external";

export type PaymentRoute = {
  rail: PaymentRail;
  methodType: PaymentMethodType;
};
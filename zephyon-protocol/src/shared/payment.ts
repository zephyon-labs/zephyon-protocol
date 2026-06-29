export type PaymentMethodType =
  | "wallet"
  | "bank"
  | "card"
  | "external";

export type PaymentRail =
  | "solana"
  | "ach"
  | "fednow"
  | "rtp"
  | "visa"
  | "mastercard"
  | "swift"
  | "x402"
  | "internal";
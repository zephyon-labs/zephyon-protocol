import type { PaymentIntent } from "../shared/paymentIntent";

export type CompliancePolicy = {
  requiresKyc: boolean;
  requiresKyb: boolean;
  sanctionsScreening: boolean;
  amlScreening: boolean;
  transactionMonitoring: boolean;
};

export type CompliancePolicyResolver = (
  intent: PaymentIntent
) => CompliancePolicy;
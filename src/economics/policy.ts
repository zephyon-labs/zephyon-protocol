import type { PaymentEvent } from "./types";

export type EconomicPolicyContext = {
  eventType: PaymentEvent["type"];
  baseProtocolFeeRate: number;
  isVerifiedMerchant?: boolean;
  isPremiumSubscriber?: boolean;
  zeraStakedAmount?: number;
};

export type EconomicPolicyResult = {
  effectiveProtocolFeeRate: number;
  appliedDiscounts: string[];
  policyVersion: string;
};

const POLICY_VERSION = "1.0.0";

export function applyEconomicPolicy(
  context: EconomicPolicyContext
): EconomicPolicyResult {
  let effectiveProtocolFeeRate = context.baseProtocolFeeRate;
  const appliedDiscounts: string[] = [];

  if (context.isVerifiedMerchant) {
    effectiveProtocolFeeRate -= 0.0025;
    appliedDiscounts.push("verified_merchant_discount");
  }

  if (context.isPremiumSubscriber) {
    effectiveProtocolFeeRate -= 0.0015;
    appliedDiscounts.push("premium_subscriber_discount");
  }

  if ((context.zeraStakedAmount ?? 0) >= 10_000) {
    effectiveProtocolFeeRate -= 0.001;
    appliedDiscounts.push("zera_staking_discount");
  }

  return {
    effectiveProtocolFeeRate: Math.max(effectiveProtocolFeeRate, 0),
    appliedDiscounts,
    policyVersion: POLICY_VERSION,
  };
}
import type { TrustAssessment } from "./score";
import { TrustRiskLevel, TrustMaturityLevel } from "./score";

export type TrustBenefit =
  | "higher_payment_limits"
  | "instant_settlement_eligible"
  | "reduced_review_frequency"
  | "lower_protocol_fee_eligible"
  | "merchant_priority_routing"
  | "agent_autonomy_increase"
  | "beta_feature_access";

export type TrustBenefitsResult = {
  benefits: TrustBenefit[];
  generatedAt: string;
};

export function deriveTrustBenefits(
  assessment: TrustAssessment
): TrustBenefitsResult {
  const benefits: TrustBenefit[] = [];

  if (
    assessment.riskLevel === TrustRiskLevel.LOW &&
    assessment.score >= 80
  ) {
    benefits.push("higher_payment_limits");
    benefits.push("reduced_review_frequency");
  }

  if (
    assessment.riskLevel === TrustRiskLevel.LOW &&
    assessment.maturityLevel === TrustMaturityLevel.VETERAN
  ) {
    benefits.push("instant_settlement_eligible");
    benefits.push("lower_protocol_fee_eligible");
  }

  if (assessment.maturityLevel === TrustMaturityLevel.ESTABLISHED) {
    benefits.push("beta_feature_access");
  }

  if (assessment.maturityLevel === TrustMaturityLevel.VETERAN) {
    benefits.push("merchant_priority_routing");
    benefits.push("agent_autonomy_increase");
  }

  return {
    benefits,
    generatedAt: new Date().toISOString(),
  };
}

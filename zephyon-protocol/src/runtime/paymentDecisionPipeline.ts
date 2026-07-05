import type { ComplianceEngine } from "../compliance";
import type { IdentityEngine } from "../identity";
import type { PolicyEngine } from "../policy";
import type { RiskEngine } from "../risk";
import type { TrustEngine } from "../trust";
import type { ExecutionContext } from "./executionContext";
import type { PaymentDecisionResult } from "./paymentDecisionResult";

export type PaymentDecisionPipelineConfig = {
  identityEngine?: IdentityEngine;
  complianceEngine?: ComplianceEngine;
  riskEngine?: RiskEngine;
  policyEngine?: PolicyEngine;
  trustEngine?: TrustEngine;
};

export class PaymentDecisionPipeline {
  constructor(private readonly config: PaymentDecisionPipelineConfig) {}

  async evaluate(context: ExecutionContext): Promise<PaymentDecisionResult> {
    const identity =
      context.participant && this.config.identityEngine
        ? await this.config.identityEngine.verify(context.participant)
        : context.identity;

    const compliance = this.config.complianceEngine
      ? await this.config.complianceEngine.evaluate(context.paymentIntent)
      : context.compliance;

    const risk = this.config.riskEngine
      ? await this.config.riskEngine.evaluate(context.paymentIntent)
      : context.risk;

    const policy =
      context.policyContext && this.config.policyEngine
        ? await this.config.policyEngine.evaluate(context.policyContext)
        : context.policy;

    const trust =
      context.trustEvidence && this.config.trustEngine
        ? await this.config.trustEngine.evaluate(context.trustEvidence)
        : context.trust;

    if (compliance?.status === "blocked") {
      return {
        status: "blocked",
        identity,
        compliance,
        risk,
        policy,
        trust,
        reason: compliance.reason,
      };
    }

    if (risk?.status === "blocked" || policy?.status === "blocked") {
      return {
        status: "blocked",
        identity,
        compliance,
        risk,
        policy,
        trust,
        reason: risk?.reason ?? policy?.reason,
      };
    }

    if (
      compliance?.status === "manual_review" ||
      risk?.status === "manual_review" ||
      policy?.status === "manual_review" ||
      trust?.status === "review_required"
    ) {
      return {
        status: "manual_review",
        identity,
        compliance,
        risk,
        policy,
        trust,
        reason: "Payment requires manual review.",
      };
    }

    return {
      status: "approved",
      identity,
      compliance,
      risk,
      policy,
      trust,
    };
  }
}
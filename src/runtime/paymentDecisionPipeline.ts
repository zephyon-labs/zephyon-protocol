import type { ComplianceEngine } from "../compliance";
import type { IdentityEngine } from "../identity";
import type { PolicyEngine } from "../policy";
import type { RiskEngine } from "../risk";
import type { TrustEngine } from "../trust";
import type { ExecutionContext } from "./executionContext";
import type { PaymentDecisionResult } from "./paymentDecisionResult";
import { RuntimeEventType, type RuntimeEventEmitter } from "./events";

export type PaymentDecisionPipelineConfig = {
  identityEngine?: IdentityEngine;
  complianceEngine?: ComplianceEngine;
  riskEngine?: RiskEngine;
  policyEngine?: PolicyEngine;
  trustEngine?: TrustEngine;
};

export class PaymentDecisionPipeline {
  constructor(private readonly config: PaymentDecisionPipelineConfig) {}

  async evaluate(
    context: ExecutionContext,
    emitter?: RuntimeEventEmitter,
  ): Promise<PaymentDecisionResult> {
    const identity = emitter
      ? await emitter.measure(
          {
            startedType: RuntimeEventType.IdentityStarted,
            completedType: RuntimeEventType.IdentityCompleted,
            failedType: RuntimeEventType.IdentityFailed,
            stage: "identity",
            message: "Evaluating participant identity.",
          },
          async () =>
            context.participant && this.config.identityEngine
              ? this.config.identityEngine.verify(context.participant)
              : context.identity,
        )
      : context.participant && this.config.identityEngine
        ? await this.config.identityEngine.verify(context.participant)
        : context.identity;

    const compliance = emitter
      ? await emitter.measure(
          {
            startedType: RuntimeEventType.ComplianceStarted,
            completedType: RuntimeEventType.ComplianceCompleted,
            failedType: RuntimeEventType.ComplianceFailed,
            stage: "compliance",
            message: "Evaluating payment compliance.",
          },
          async () =>
            this.config.complianceEngine
              ? this.config.complianceEngine.evaluate(context.paymentIntent)
              : context.compliance,
        )
      : this.config.complianceEngine
        ? await this.config.complianceEngine.evaluate(context.paymentIntent)
        : context.compliance;

    const risk = emitter
      ? await emitter.measure(
          {
            startedType: RuntimeEventType.RiskStarted,
            completedType: RuntimeEventType.RiskCompleted,
            failedType: RuntimeEventType.RiskFailed,
            stage: "risk",
            message: "Evaluating payment risk.",
          },
          async () =>
            this.config.riskEngine
              ? this.config.riskEngine.evaluate(context.paymentIntent)
              : context.risk,
        )
      : this.config.riskEngine
        ? await this.config.riskEngine.evaluate(context.paymentIntent)
        : context.risk;

    const policy = emitter
      ? await emitter.measure(
          {
            startedType: RuntimeEventType.PolicyStarted,
            completedType: RuntimeEventType.PolicyCompleted,
            failedType: RuntimeEventType.PolicyFailed,
            stage: "policy",
            message: "Evaluating payment policy.",
          },
          async () =>
            context.policyContext && this.config.policyEngine
              ? this.config.policyEngine.evaluate(context.policyContext)
              : context.policy,
        )
      : context.policyContext && this.config.policyEngine
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
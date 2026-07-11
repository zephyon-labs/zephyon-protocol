import {
  ComplianceEngine,
  type ComplianceService,
} from "../compliance";
import {
  IdentityEngine,
  type IdentityService,
} from "../identity";
import {
  PolicyEngine,
  type PolicyService,
} from "../policy";
import {
  RiskEngine,
  type RiskService,
} from "../risk";
import {
  InMemoryPaymentAdapterRegistry,
  PaymentOrchestrator,
  resolvePaymentRail,
  validatePaymentIntent,
} from "../shared";
import { InternalLedgerAdapter } from "../adapters";
import { PaymentDecisionPipeline } from "./paymentDecisionPipeline";
import { PaymentRuntime } from "./paymentRuntime";

const approvingComplianceService: ComplianceService = {
  async evaluate() {
    return {
      status: "approved",
      reason: "approved_by_policy",
      decidedAt: new Date().toISOString(),
    };
  },
};

const approvingRiskService: RiskService = {
  async evaluate() {
    return {
      status: "approved",
      decidedAt: new Date().toISOString(),
      assessment: {
        score: 5,
        level: "low",
        assessedAt: new Date().toISOString(),
        factors: [],
      },
      reason: "Low-risk runtime smoke path.",
    };
  },
};

const approvingPolicyService: PolicyService = {
  async evaluate() {
    return {
      status: "approved",
      decidedAt: new Date().toISOString(),
      results: [],
      reason: "Approved by default runtime policy.",
    };
  },
};

const approvingIdentityService: IdentityService = {
  async verify() {
    return {
      successful: true,
      identity: {
        level: "basic",
        verifiedAt: new Date().toISOString(),
        provider: "runtime-smoke",
      },
      referenceId: `identity-${crypto.randomUUID()}`,
    };
  },
};

export function createPaymentRuntime(): PaymentRuntime {
  const registry = new InMemoryPaymentAdapterRegistry();
  registry.register(new InternalLedgerAdapter());

  const decisionPipeline = new PaymentDecisionPipeline({
    identityEngine: new IdentityEngine(approvingIdentityService),
    complianceEngine: new ComplianceEngine(approvingComplianceService),
    riskEngine: new RiskEngine(approvingRiskService),
    policyEngine: new PolicyEngine(approvingPolicyService),
  });

  const orchestrator = new PaymentOrchestrator({
    clock: () => new Date().toISOString(),
    createTransactionId: () => `txn-${crypto.randomUUID()}`,

    validateIntent: (paymentIntent) => {
      const validation = validatePaymentIntent(paymentIntent);

      if (validation.isValid) {
        return { valid: true };
      }

      return {
        valid: false,
        failure: {
          code: "PAYMENT_INTENT_INVALID",
          reason: validation.errors.join(" "),
          recoverable: false,
        },
      };
    },

    resolveRail: (paymentIntent) =>
      resolvePaymentRail({
        intent: paymentIntent,
        preferredRail: "internal",
        availableRails: registry.listRails(),
      }),

    executePayment: (paymentIntent, transaction) => {
      const adapter = registry.getAdapter(transaction.rail);
      return adapter.execute(paymentIntent, transaction);
    },

    monitorSettlement: (paymentIntent, transaction) => {
      const adapter = registry.getAdapter(transaction.rail);
      return adapter.monitorSettlement(paymentIntent, transaction);
    },

    recordHistory: (result) => {
      console.log("Runtime history recorder saw:", {
        status: result.status,
        transactionId: result.transaction.id,
        rail: result.transaction.rail,
      });
    },
  });

  return new PaymentRuntime(decisionPipeline, orchestrator);
}
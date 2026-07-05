import type { PaymentOrchestrationResult, PaymentOrchestrator } from "../shared/paymentOrchestrator";
import type { ExecutionContext } from "./executionContext";
import type { PaymentDecisionPipeline } from "./paymentDecisionPipeline";
import type { PaymentDecisionResult } from "./paymentDecisionResult";

export type PaymentRuntimeResult = {
  decision: PaymentDecisionResult;
  orchestration?: PaymentOrchestrationResult;
};

export class PaymentRuntime {
  constructor(
    private readonly decisionPipeline: PaymentDecisionPipeline,
    private readonly orchestrator: PaymentOrchestrator
  ) {}

  async execute(context: ExecutionContext): Promise<PaymentRuntimeResult> {
    const decision = await this.decisionPipeline.evaluate(context);

    if (decision.status !== "approved") {
      return { decision };
    }

    const orchestration = await this.orchestrator.execute({
      intent: context.paymentIntent,
      amount: context.paymentIntent.money.amount,
      currency: context.paymentIntent.money.asset,
      context: {
        requestedAt: context.requestedAt,
        environment: context.environment,
        requestId: context.requestId,
        actorId: context.participant?.id,
        metadata: context.metadata,
      },
    });

    return {
      decision,
      orchestration,
    };
  }
}
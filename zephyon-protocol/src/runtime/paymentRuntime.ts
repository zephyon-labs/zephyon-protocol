import type { PaymentOrchestrationResult, PaymentOrchestrator } from "../shared/paymentOrchestrator";
import type { ExecutionContext } from "./executionContext";
import type { PaymentDecisionPipeline } from "./paymentDecisionPipeline";
import type { PaymentDecisionResult } from "./paymentDecisionResult";
import {
  createRuntimeEventBus,
  createRuntimeEventEmitter,
  RuntimeEventType,
  type RuntimeEventBus,
} from "./events";

export type PaymentRuntimeResult = {
  decision: PaymentDecisionResult;
  orchestration?: PaymentOrchestrationResult;
};

export class PaymentRuntime {
  constructor(
    private readonly decisionPipeline: PaymentDecisionPipeline,
    private readonly orchestrator: PaymentOrchestrator,
    private readonly eventBus: RuntimeEventBus = createRuntimeEventBus()
  ) {}

  getEvents() {
    return this.eventBus.getEvents();
  }

  async execute(context: ExecutionContext): Promise<PaymentRuntimeResult> {
    const emitter = createRuntimeEventEmitter(this.eventBus, {
      runtimeId: context.requestId,
      paymentId: context.paymentIntent.id,
    });

    emitter.emit({
      type: RuntimeEventType.RuntimeStarted,
      stage: "runtime",
      status: "started",
      message: "Payment runtime started.",
      metadata: {
        environment: context.environment,
        requestedAt: context.requestedAt,
        actorId: context.participant?.id,
      },
    });

    try {
      const decision = await emitter.measure(
        {
          startedType: RuntimeEventType.PolicyStarted,
          completedType: RuntimeEventType.PolicyCompleted,
          failedType: RuntimeEventType.PolicyFailed,
          stage: "policy",
          message: "Evaluating payment decision pipeline.",
        },
        () => this.decisionPipeline.evaluate(context)
      );

      if (decision.status !== "approved") {
        emitter.emit({
          type: RuntimeEventType.PaymentFailed,
          stage: "payment",
          status: "failed",
          message: "Payment was not approved by the decision pipeline.",
          metadata: {
            decisionStatus: decision.status,
            decision,
          },
        });

        emitter.emit({
          type: RuntimeEventType.RuntimeCompleted,
          stage: "runtime",
          status: "completed",
          message: "Payment runtime completed without settlement.",
          metadata: {
            decisionStatus: decision.status,
          },
        });

        return { decision };
      }

      const orchestration = await emitter.measure(
        {
          startedType: RuntimeEventType.OrchestrationStarted,
          completedType: RuntimeEventType.OrchestrationCompleted,
          failedType: RuntimeEventType.OrchestrationFailed,
          stage: "orchestration",
          message: "Executing payment orchestration.",
          metadata: {
            asset: context.paymentIntent.money.asset,
            amount: context.paymentIntent.money.amount,
          },
        },
        () =>
          this.orchestrator.execute({
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
          })
      );

      emitter.emit({
        type: RuntimeEventType.PaymentCompleted,
        stage: "payment",
        status: "completed",
        message: "Payment completed successfully.",
        metadata: {
          orchestration,
        },
      });

      emitter.emit({
        type: RuntimeEventType.RuntimeCompleted,
        stage: "runtime",
        status: "completed",
        message: "Payment runtime completed successfully.",
      });

      return {
        decision,
        orchestration,
      };
    } catch (error) {
      emitter.emit({
        type: RuntimeEventType.RuntimeFailed,
        stage: "runtime",
        status: "failed",
        message: error instanceof Error ? error.message : "Unknown runtime failure.",
        metadata: {
          error,
        },
      });

      throw error;
    }
  }
}
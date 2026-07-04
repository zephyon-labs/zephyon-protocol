import type { PaymentIntent } from "./paymentIntent";
import type { PaymentReceipt } from "./paymentReceipt";
import type { PaymentRail } from "./paymentRail";
import type { IsoTimestamp } from "./time";
import {
  createPaymentTransaction,
  isTerminalTransactionStatus,
  markTransactionAwaitingSettlement,
  markTransactionCompleted,
  markTransactionFailed,
  markTransactionProcessing,
  markTransactionReady,
  markTransactionSettled,
  markTransactionValidating,
  type BlockchainSettlementDetails,
  type PaymentTransaction,
  type PaymentTransactionFailure,
  type PaymentTransactionId,
  type PaymentTransactionMetadata,
} from "./paymentTransaction";

export type PaymentOrchestratorId = string;

export type PaymentOrchestrationStatus =
  | "started"
  | "validated"
  | "processing"
  | "awaiting_settlement"
  | "settled"
  | "completed"
  | "failed"
  | "cancelled";

export type PaymentOrchestrationFailure = {
  code: string;
  reason: string;
  recoverable: boolean;
};

export type PaymentOrchestrationContext = {
  orchestratorId?: PaymentOrchestratorId;
  requestedAt: IsoTimestamp;
  environment?: string;
  requestId?: string;
  actorId?: string;
  metadata?: PaymentTransactionMetadata;
};

export type PaymentOrchestratorValidationResult = {
  valid: boolean;
  failure?: PaymentOrchestrationFailure;
};

export type PaymentRailResolutionResult = {
  rail: PaymentRail;
  reason?: string;
};

export type PaymentExecutionResult = {
  submittedAt?: IsoTimestamp;
  blockchain?: BlockchainSettlementDetails;
};

export type PaymentSettlementResult = {
  settledAt?: IsoTimestamp;
  blockchain?: BlockchainSettlementDetails;
};

export type PaymentReceiptCreationResult = {
  receipt?: PaymentReceipt;
};

export type PaymentOrchestrationResult = {
  status: PaymentOrchestrationStatus;
  intent: PaymentIntent;
  transaction: PaymentTransaction;
  receipt?: PaymentReceipt;
  failure?: PaymentOrchestrationFailure;
};

export type PaymentOrchestratorClock = () => IsoTimestamp;

export type PaymentOrchestratorIdFactory = () => PaymentTransactionId;

export type PaymentIntentValidator = (
  intent: PaymentIntent,
  context: PaymentOrchestrationContext
) =>
  | PaymentOrchestratorValidationResult
  | Promise<PaymentOrchestratorValidationResult>;

export type PaymentRailResolver = (
  intent: PaymentIntent,
  context: PaymentOrchestrationContext
) => PaymentRailResolutionResult | Promise<PaymentRailResolutionResult>;

export type PaymentExecutor = (
  intent: PaymentIntent,
  transaction: PaymentTransaction,
  context: PaymentOrchestrationContext
) => PaymentExecutionResult | Promise<PaymentExecutionResult>;

export type PaymentSettlementMonitor = (
  intent: PaymentIntent,
  transaction: PaymentTransaction,
  context: PaymentOrchestrationContext
) => PaymentSettlementResult | Promise<PaymentSettlementResult>;

export type PaymentReceiptCreator = (
  intent: PaymentIntent,
  transaction: PaymentTransaction,
  context: PaymentOrchestrationContext
) => PaymentReceiptCreationResult | Promise<PaymentReceiptCreationResult>;

export type PaymentHistoryRecorder = (
  result: PaymentOrchestrationResult,
  context: PaymentOrchestrationContext
) => void | Promise<void>;

export type PaymentOrchestratorConfig = {
  clock: PaymentOrchestratorClock;
  createTransactionId: PaymentOrchestratorIdFactory;

  validateIntent: PaymentIntentValidator;
  resolveRail: PaymentRailResolver;
  executePayment: PaymentExecutor;
  monitorSettlement: PaymentSettlementMonitor;
  createReceipt?: PaymentReceiptCreator;
  recordHistory?: PaymentHistoryRecorder;
};

export type ExecutePaymentInput = {
  intent: PaymentIntent;
  amount: number;
  currency: string;
  context: PaymentOrchestrationContext;
};

export class PaymentOrchestrator {
  private readonly config: PaymentOrchestratorConfig;

  constructor(config: PaymentOrchestratorConfig) {
    this.config = config;
  }

  async execute(input: ExecutePaymentInput): Promise<PaymentOrchestrationResult> {
    const { intent, amount, currency, context } = input;

    const resolvedRail = await this.config.resolveRail(intent, context);

    let transaction = createPaymentTransaction({
      id: this.config.createTransactionId(),
      intentId: intent.id,
      rail: resolvedRail.rail,
      amount,
      currency,
      createdAt: context.requestedAt,
      metadata: context.metadata,
    });

    try {
      transaction = markTransactionValidating(transaction, this.config.clock());

      const validation = await this.config.validateIntent(intent, context);

      if (!validation.valid) {
        const failure =
          validation.failure ??
          createOrchestrationFailure(
            "PAYMENT_VALIDATION_FAILED",
            "Payment intent failed validation.",
            false
          );

        transaction = markTransactionFailed(
          transaction,
          this.config.clock(),
          orchestrationFailureToTransactionFailure(failure)
        );

        return this.finalize(
          {
            status: "failed",
            intent,
            transaction,
            failure,
          },
          context
        );
      }

      transaction = markTransactionReady(transaction, this.config.clock());

      transaction = markTransactionProcessing(transaction, this.config.clock());

      const execution = await this.config.executePayment(
        intent,
        transaction,
        context
      );

      transaction = markTransactionAwaitingSettlement(
        transaction,
        this.config.clock(),
        execution.blockchain
      );

      const settlement = await this.config.monitorSettlement(
        intent,
        transaction,
        context
      );

      transaction = markTransactionSettled(
        transaction,
        this.config.clock(),
        settlement.settledAt ?? this.config.clock(),
        settlement.blockchain ?? execution.blockchain
      );

      transaction = markTransactionCompleted(
        transaction,
        this.config.clock(),
        this.config.clock()
      );

      const receiptResult = this.config.createReceipt
        ? await this.config.createReceipt(intent, transaction, context)
        : undefined;

      return this.finalize(
        {
          status: "completed",
          intent,
          transaction,
          receipt: receiptResult?.receipt,
        },
        context
      );
    } catch (error) {
      const failure = normalizeOrchestrationError(error);

      if (!isTerminalTransactionStatus(transaction.status)) {
        transaction = markTransactionFailed(
          transaction,
          this.config.clock(),
          orchestrationFailureToTransactionFailure(failure)
        );
      }

      return this.finalize(
        {
          status: "failed",
          intent,
          transaction,
          failure,
        },
        context
      );
    }
  }

  private async finalize(
    result: PaymentOrchestrationResult,
    context: PaymentOrchestrationContext
  ): Promise<PaymentOrchestrationResult> {
    if (this.config.recordHistory) {
      await this.config.recordHistory(result, context);
    }

    return result;
  }
}

function createOrchestrationFailure(
  code: string,
  reason: string,
  recoverable: boolean
): PaymentOrchestrationFailure {
  return {
    code,
    reason,
    recoverable,
  };
}

function orchestrationFailureToTransactionFailure(
  failure: PaymentOrchestrationFailure
): PaymentTransactionFailure {
  return {
    code: failure.code,
    reason: failure.reason,
    recoverable: failure.recoverable,
  };
}

function normalizeOrchestrationError(error: unknown): PaymentOrchestrationFailure {
  if (error instanceof Error) {
    return {
      code: "PAYMENT_ORCHESTRATION_ERROR",
      reason: error.message,
      recoverable: false,
    };
  }

  return {
    code: "UNKNOWN_PAYMENT_ORCHESTRATION_ERROR",
    reason: "An unknown payment orchestration error occurred.",
    recoverable: false,
  };
}
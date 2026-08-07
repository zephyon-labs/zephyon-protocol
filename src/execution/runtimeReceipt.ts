import type { PaymentRail } from "../shared/paymentRail";
import type { ExactAmount } from "./exactValues";
import type { CanonicalPaymentIntentId, ExecutionId, ProviderReference, TransactionId } from "./identifiers";
import type { RailEvidence } from "./railEvidence";
import type { CanonicalExecutionContext } from "./executionContext";
import type { SettlementObservation } from "./settlementObservation";
import { copyJsonObject } from "./json";
import { parseCanonicalIdentifier } from "./identifiers";
import { parseTimestamp } from "./executionContext";

export type RuntimeReceipt<E extends RailEvidence = RailEvidence> = Readonly<{
  schemaVersion: 1;
  receiptId: string;
  paymentIntentId: CanonicalPaymentIntentId;
  executionId: ExecutionId;
  transactionId: TransactionId;
  rail: PaymentRail;
  amount: ExactAmount;
  senderId: string;
  recipientId: string;
  settledAt: string;
  providerReference?: ProviderReference;
  evidence: E;
  createdAt: string;
}>;

export type RuntimeReceiptFactoryDependencies = Readonly<{
  receiptIdFactory: (context: CanonicalExecutionContext) => string;
  clock: () => string;
}>;

export function createRuntimeExecutionReceipt<E extends RailEvidence>(
  context: CanonicalExecutionContext,
  observation: SettlementObservation<E>,
  dependencies: RuntimeReceiptFactoryDependencies,
): RuntimeReceipt<E> {
  if (observation.outcome !== "settled") {
    throw new Error("A Runtime receipt requires a conclusive settled observation.");
  }
  const receiptId = parseCanonicalIdentifier(dependencies.receiptIdFactory(context), "receiptId");
  const createdAt = parseTimestamp(dependencies.clock(), "receipt.createdAt");
  return Object.freeze({
    schemaVersion: 1,
    receiptId,
    paymentIntentId: context.paymentIntentId,
    executionId: context.executionId,
    transactionId: context.transactionId,
    rail: context.selectedRail,
    amount: Object.freeze({ ...context.amount }),
    senderId: context.actor.id,
    recipientId: context.recipient.id,
    settledAt: parseTimestamp(observation.settledAt, "receipt.settledAt"),
    providerReference: observation.providerReference,
    evidence: Object.freeze({
      type: observation.evidence.type,
      version: observation.evidence.version,
      data: copyJsonObject(observation.evidence.data, "receipt.evidence.data"),
    }) as E,
    createdAt,
  });
}

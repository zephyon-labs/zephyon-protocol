import type { PaymentRail } from "../shared/paymentRail";
import { createExactAmount, strictObject, type ExactAmount } from "./exactValues";
import {
  parseCorrelationId,
  parseCanonicalIdentifier,
  parseExecutionId,
  parsePaymentIntentId,
  parseProviderIdempotencyKey,
  parseRuntimeRequestId,
  parseTransactionId,
  type CanonicalPaymentIntentId,
  type CorrelationId,
  type ExecutionId,
  type ProviderIdempotencyKey,
  type RuntimeRequestId,
  type TransactionId,
} from "./identifiers";
import { copyJsonObject, type JsonObject } from "./json";

const PAYMENT_RAILS: readonly PaymentRail[] = [
  "mock", "solana", "card", "ach", "fednow", "rtp", "visa", "mastercard",
  "swift", "x402", "internal",
];

export type CanonicalActor = Readonly<{
  id: string;
  type: "person" | "business" | "agent" | "system";
}>;

export type CanonicalRecipientSnapshot = Readonly<{
  id: string;
  type: "person" | "business" | "agent" | "system";
  snapshotVersion: number;
  data: JsonObject;
}>;

export type CanonicalDestination =
  | Readonly<{ type: "wallet"; network: string; address: string }>
  | Readonly<{ type: "bank_account"; country: string; accountReference: string }>
  | Readonly<{ type: "card"; processor: string; paymentMethodReference: string }>
  | Readonly<{ type: "mock"; accountReference: string }>
  | Readonly<{ type: "internal_account"; accountReference: string }>;

export type RuntimeDecisionEvidence = Readonly<{
  decisionId: string;
  status: "approved";
  evaluatedAt: string;
}>;

export type CanonicalExecutionContext = Readonly<{
  schemaVersion: 1;
  requestId: RuntimeRequestId;
  correlationId: CorrelationId;
  executionId: ExecutionId;
  paymentIntentId: CanonicalPaymentIntentId;
  transactionId: TransactionId;
  requestedAt: string;
  actor: CanonicalActor;
  recipient: CanonicalRecipientSnapshot;
  amount: ExactAmount;
  destination: CanonicalDestination;
  selectedRail: PaymentRail;
  providerIdempotencyKey: ProviderIdempotencyKey;
  decision: RuntimeDecisionEvidence;
}>;

export type RailExecutionCommand = Readonly<{
  schemaVersion: 1;
  requestId: RuntimeRequestId;
  correlationId: CorrelationId;
  executionId: ExecutionId;
  paymentIntentId: CanonicalPaymentIntentId;
  transactionId: TransactionId;
  requestedAt: string;
  actorId: string;
  recipientId: string;
  amount: ExactAmount;
  destination: CanonicalDestination;
  rail: PaymentRail;
  providerIdempotencyKey: ProviderIdempotencyKey;
}>;

export function createCanonicalExecutionContext(input: unknown): CanonicalExecutionContext {
  const record = strictObject(input, [
    "schemaVersion", "requestId", "correlationId", "executionId", "paymentIntentId",
    "transactionId", "requestedAt", "actor", "recipient", "amount", "destination",
    "selectedRail", "providerIdempotencyKey", "decision",
  ], "executionContext");
  if (record.schemaVersion !== 1) throw new Error("executionContext.schemaVersion must be 1.");
  const selectedRail = parseRail(record.selectedRail);
  const destination = parseDestination(record.destination);
  validateRailDestination(selectedRail, destination);
  const amount = createExactAmount(record.amount);
  if (amount.units === "0") throw new Error("executionContext.amount.units must be greater than zero.");
  return Object.freeze({
    schemaVersion: 1,
    requestId: parseRuntimeRequestId(record.requestId),
    correlationId: parseCorrelationId(record.correlationId),
    executionId: parseExecutionId(record.executionId),
    paymentIntentId: parsePaymentIntentId(record.paymentIntentId),
    transactionId: parseTransactionId(record.transactionId),
    requestedAt: parseTimestamp(record.requestedAt, "executionContext.requestedAt"),
    actor: parseActor(record.actor),
    recipient: parseRecipient(record.recipient),
    amount,
    destination,
    selectedRail,
    providerIdempotencyKey: parseProviderIdempotencyKey(record.providerIdempotencyKey),
    decision: parseDecision(record.decision),
  });
}

export function createRailExecutionCommand(context: CanonicalExecutionContext): RailExecutionCommand {
  return Object.freeze({
    schemaVersion: 1,
    requestId: context.requestId,
    correlationId: context.correlationId,
    executionId: context.executionId,
    paymentIntentId: context.paymentIntentId,
    transactionId: context.transactionId,
    requestedAt: context.requestedAt,
    actorId: context.actor.id,
    recipientId: context.recipient.id,
    amount: Object.freeze({ ...context.amount }),
    destination: Object.freeze({ ...context.destination }),
    rail: context.selectedRail,
    providerIdempotencyKey: context.providerIdempotencyKey,
  });
}

function parseActor(value: unknown): CanonicalActor {
  const record = strictObject(value, ["id", "type"], "executionContext.actor");
  const type = parsePartyType(record.type, "executionContext.actor.type");
  return Object.freeze({ id: parseCanonicalIdentifier(record.id, "executionContext.actor.id"), type });
}

function parseRecipient(value: unknown): CanonicalRecipientSnapshot {
  const record = strictObject(value, ["id", "type", "snapshotVersion", "data"], "executionContext.recipient");
  if (!Number.isSafeInteger(record.snapshotVersion) || Number(record.snapshotVersion) < 1) {
    throw new Error("executionContext.recipient.snapshotVersion must be a positive safe integer.");
  }
  return Object.freeze({
    id: parseCanonicalIdentifier(record.id, "executionContext.recipient.id"),
    type: parsePartyType(record.type, "executionContext.recipient.type"),
    snapshotVersion: Number(record.snapshotVersion),
    data: copyJsonObject(record.data, "executionContext.recipient.data"),
  });
}

function parseDecision(value: unknown): RuntimeDecisionEvidence {
  const record = strictObject(value, ["decisionId", "status", "evaluatedAt"], "executionContext.decision");
  if (record.status !== "approved") throw new Error("executionContext.decision.status must be approved.");
  return Object.freeze({
    decisionId: parseCanonicalIdentifier(record.decisionId, "executionContext.decision.decisionId"),
    status: "approved",
    evaluatedAt: parseTimestamp(record.evaluatedAt, "executionContext.decision.evaluatedAt"),
  });
}

function parseDestination(value: unknown): CanonicalDestination {
  const base = strictObject(value, ["type", "network", "address", "country", "accountReference", "processor", "paymentMethodReference"], "executionContext.destination");
  switch (base.type) {
    case "wallet": {
      const record = strictObject(value, ["type", "network", "address"], "executionContext.destination");
      return Object.freeze({ type: "wallet", network: parseNonBlank(record.network, "destination.network"), address: parseNonBlank(record.address, "destination.address") });
    }
    case "bank_account": {
      const record = strictObject(value, ["type", "country", "accountReference"], "executionContext.destination");
      return Object.freeze({ type: "bank_account", country: parseCountry(record.country), accountReference: parseNonBlank(record.accountReference, "destination.accountReference") });
    }
    case "card": {
      const record = strictObject(value, ["type", "processor", "paymentMethodReference"], "executionContext.destination");
      return Object.freeze({ type: "card", processor: parseNonBlank(record.processor, "destination.processor"), paymentMethodReference: parseNonBlank(record.paymentMethodReference, "destination.paymentMethodReference") });
    }
    case "mock": {
      const record = strictObject(value, ["type", "accountReference"], "executionContext.destination");
      return Object.freeze({ type: "mock", accountReference: parseNonBlank(record.accountReference, "destination.accountReference") });
    }
    case "internal_account": {
      const record = strictObject(value, ["type", "accountReference"], "executionContext.destination");
      return Object.freeze({ type: "internal_account", accountReference: parseNonBlank(record.accountReference, "destination.accountReference") });
    }
    default:
      throw new Error("executionContext.destination.type is unsupported.");
  }
}

function validateRailDestination(rail: PaymentRail, destination: CanonicalDestination): void {
  const expected: Record<PaymentRail, CanonicalDestination["type"]> = {
    mock: "mock", solana: "wallet", card: "card", ach: "bank_account",
    fednow: "bank_account", rtp: "bank_account", visa: "card", mastercard: "card",
    swift: "bank_account", x402: "wallet", internal: "internal_account",
  };
  if (destination.type !== expected[rail]) {
    throw new Error(`Rail ${rail} is incompatible with destination type ${destination.type}.`);
  }
  if (rail === "solana" && destination.type === "wallet" &&
      !["solana", "solana-devnet", "solana-testnet", "solana-mainnet"].includes(destination.network)) {
    throw new Error("Solana rail requires a Solana wallet network.");
  }
}

function parseRail(value: unknown): PaymentRail {
  if (typeof value !== "string" || !PAYMENT_RAILS.includes(value as PaymentRail)) {
    throw new Error("executionContext.selectedRail is unsupported.");
  }
  return value as PaymentRail;
}

function parsePartyType(value: unknown, name: string): CanonicalActor["type"] {
  if (value !== "person" && value !== "business" && value !== "agent" && value !== "system") {
    throw new Error(`${name} is unsupported.`);
  }
  return value;
}

function parseCountry(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]{2}$/.test(value)) throw new Error("destination.country must be an ISO alpha-2 code.");
  return value;
}

function parseNonBlank(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 512 || value.trim() !== value) {
    throw new Error(`${name} must be a bounded non-blank string.`);
  }
  return value;
}

export function parseTimestamp(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${name} must be a canonical UTC timestamp.`);
  }
  return value;
}

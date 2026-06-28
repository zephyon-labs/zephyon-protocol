import { AnalyticsEngine } from "./analytics";
import { processEconomicEvent } from "./engine";
import { applyRevenueAllocation, createEmptyTreasury } from "./treasury";
import type { PaymentEvent } from "./types";

import {
  createTrustEvidence,
  createTrustSignal,
  evaluateTrust,
  type TrustSignal,
  TrustSignalType,
  TrustSubjectType,
} from "../trust";

const participantRegistry: Record<string, TrustSubjectType> = {
  user_matt: TrustSubjectType.HUMAN,
  user_alex: TrustSubjectType.HUMAN,
  merchant_pizza_shop: TrustSubjectType.MERCHANT,
  agent_research_bot: TrustSubjectType.AGENT,
  agent_data_provider: TrustSubjectType.AGENT,
};

function getSubjectType(participantId: string): TrustSubjectType {
  return participantRegistry[participantId] ?? TrustSubjectType.HUMAN;
}

const demoEvents: PaymentEvent[] = [
  {
    type: "P2P_PAYMENT_COMPLETED",
    amountUsd: 25,
    protocolFeeRate: 0.01,
    timestamp: new Date().toISOString(),
    sender: "user_matt",
    receiver: "user_alex",
    receiptId: "demo_receipt_001",
  },
  {
    type: "MERCHANT_PAYMENT_COMPLETED",
    amountUsd: 75,
    protocolFeeRate: 0.02,
    timestamp: new Date().toISOString(),
    sender: "user_matt",
    receiver: "merchant_pizza_shop",
    receiptId: "demo_receipt_002",
  },
  {
    type: "P2P_PAYMENT_COMPLETED",
    amountUsd: 40,
    protocolFeeRate: 0.01,
    timestamp: new Date().toISOString(),
    sender: "user_alex",
    receiver: "user_matt",
    receiptId: "demo_receipt_003",
  },
  {
    type: "AGENT_PAYMENT_COMPLETED",
    amountUsd: 5,
    protocolFeeRate: 0.005,
    timestamp: new Date().toISOString(),
    sender: "agent_research_bot",
    receiver: "agent_data_provider",
    receiptId: "demo_receipt_004",
  },
];

let treasury = createEmptyTreasury();
const analytics = new AnalyticsEngine();
const trustSignals: TrustSignal[] = [];

for (const event of demoEvents) {
  const result = processEconomicEvent(event);

  treasury = applyRevenueAllocation(treasury, result.allocation);
  analytics.record(result);

  if (event.sender) {
    trustSignals.push(
      createTrustSignal({
        subjectId: event.sender,
        subjectType: getSubjectType(event.sender),
        signalType:
          event.type === "AGENT_PAYMENT_COMPLETED"
            ? TrustSignalType.AGENT_TASK_COMPLETED
            : TrustSignalType.PAYMENT_SENT,
        confidenceWeight:
          event.type === "AGENT_PAYMENT_COMPLETED" ? 2 : 1,
        source: "economic-simulation",
        metadata: {
          role: "sender",
          receiptId: event.receiptId,
          paymentType: event.type,
          amountUsd: event.amountUsd,
        },
      })
    );
  }

  if (event.receiver) {
    trustSignals.push(
      createTrustSignal({
        subjectId: event.receiver,
        subjectType: getSubjectType(event.receiver),
        signalType:
          event.type === "AGENT_PAYMENT_COMPLETED"
            ? TrustSignalType.AGENT_TASK_COMPLETED
            : TrustSignalType.PAYMENT_RECEIVED,
        confidenceWeight:
          event.type === "MERCHANT_PAYMENT_COMPLETED" ||
          event.type === "AGENT_PAYMENT_COMPLETED"
            ? 2
            : 1,
        source: "economic-simulation",
        metadata: {
          role: "receiver",
          receiptId: event.receiptId,
          paymentType: event.type,
          amountUsd: event.amountUsd,
        },
      })
    );
  }
}

const participantAssessments = Array.from(
  new Map(
    trustSignals.map((signal) => [signal.subjectId, signal.subjectType])
  ).entries()
).map(([subjectId, subjectType]) => {
  const subjectSignals = trustSignals.filter(
    (signal) => signal.subjectId === subjectId
  );

  const evidence = createTrustEvidence(
    subjectId,
    subjectType,
    subjectSignals
  );

  return {
    subjectId,
    subjectType,
    evidence,
    assessment: evaluateTrust(evidence),
  };
});

console.log("Treasury Balances:");
console.log(JSON.stringify(treasury, null, 2));

console.log("Analytics Snapshot:");
console.log(JSON.stringify(analytics.snapshot(), null, 2));

console.log("Trust Signals:");
console.log(JSON.stringify(trustSignals, null, 2));

console.log("Participant Trust Assessments:");
console.log(JSON.stringify(participantAssessments, null, 2));
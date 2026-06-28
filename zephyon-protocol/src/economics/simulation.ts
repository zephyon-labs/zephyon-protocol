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
        subjectType: TrustSubjectType.HUMAN,
        signalType: TrustSignalType.PAYMENT_SENT,
        confidenceWeight: 1,
        source: "economic-simulation",
        metadata: {
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
        subjectType:
          event.type === "MERCHANT_PAYMENT_COMPLETED"
            ? TrustSubjectType.MERCHANT
            : TrustSubjectType.HUMAN,
        signalType: TrustSignalType.PAYMENT_RECEIVED,
        confidenceWeight:
          event.type === "MERCHANT_PAYMENT_COMPLETED" ? 2 : 1,
        source: "economic-simulation",
        metadata: {
          receiptId: event.receiptId,
          paymentType: event.type,
          amountUsd: event.amountUsd,
        },
      })
    );
  }
}

const mattTrustSignals = trustSignals.filter(
  (signal) => signal.subjectId === "user_matt"
);

const mattTrustEvidence = createTrustEvidence(
  "user_matt",
  TrustSubjectType.HUMAN,
  mattTrustSignals
);

const mattTrustScore = evaluateTrust(mattTrustEvidence);

console.log("Treasury Balances:");
console.log(JSON.stringify(treasury, null, 2));

console.log("Analytics Snapshot:");
console.log(JSON.stringify(analytics.snapshot(), null, 2));

console.log("Trust Signals:");
console.log(JSON.stringify(trustSignals, null, 2));

console.log("Matt Trust Evidence:");
console.log(JSON.stringify(mattTrustEvidence, null, 2));

console.log("Matt Trust Score:");
console.log(JSON.stringify(mattTrustScore, null, 2));
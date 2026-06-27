import type { PaymentEvent } from "./types";
import { processEconomicEvent } from "./engine";
import { createEmptyTreasury, applyRevenueAllocation } from "./treasury";
import { AnalyticsEngine } from "./analytics";

const demoEvents: PaymentEvent[] = [
  {
    type: "P2P_PAYMENT_COMPLETED",
    amountUsd: 25,
    protocolFeeRate: 0.005,
    timestamp: new Date().toISOString(),
    sender: "demo_sender_1",
    receiver: "demo_receiver_1",
    receiptId: "demo_receipt_001",
  },
  {
    type: "P2P_PAYMENT_COMPLETED",
    amountUsd: 40,
    protocolFeeRate: 0.005,
    timestamp: new Date().toISOString(),
    sender: "demo_sender_2",
    receiver: "demo_receiver_2",
    receiptId: "demo_receipt_002",
  },
  {
    type: "MERCHANT_PAYMENT_COMPLETED",
    amountUsd: 75,
    protocolFeeRate: 0.02,
    timestamp: new Date().toISOString(),
    sender: "demo_customer",
    receiver: "demo_merchant",
    receiptId: "demo_receipt_003",
  },
];

let treasury = createEmptyTreasury();
const analytics = new AnalyticsEngine();

for (const event of demoEvents) {
  const result = processEconomicEvent(event);
  treasury = applyRevenueAllocation(treasury, result.allocation);
  analytics.record(result);
}

console.log("Treasury Balances:");
console.log(JSON.stringify(treasury, null, 2));

console.log("Analytics Snapshot:");
console.log(JSON.stringify(analytics.snapshot(), null, 2));
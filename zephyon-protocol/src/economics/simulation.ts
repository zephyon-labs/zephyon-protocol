import type { PaymentEvent } from "./types";
import { processEconomicEvent } from "./engine";
import { createEmptyTreasury, applyRevenueAllocation } from "./treasury";

const demoEvent: PaymentEvent = {
  type: "P2P_PAYMENT_COMPLETED",
  amountUsd: 25,
  protocolFeeRate: 0.005,
  timestamp: new Date().toISOString(),
  sender: "demo_sender",
  receiver: "demo_receiver",
  receiptId: "demo_receipt_001",
};

let treasury = createEmptyTreasury();

const result = processEconomicEvent(demoEvent);
treasury = applyRevenueAllocation(treasury, result.allocation);

console.log("Economic Result:");
console.log(JSON.stringify(result, null, 2));

console.log("Treasury Balances:");
console.log(JSON.stringify(treasury, null, 2));
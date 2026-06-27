import type { PaymentEvent } from "./types";
import { processEconomicEvent } from "./engine";

const demoEvent: PaymentEvent = {
  type: "P2P_PAYMENT_COMPLETED",
  amountUsd: 25,
  protocolFeeRate: 0.005,
  timestamp: new Date().toISOString(),
  sender: "demo_sender",
  receiver: "demo_receiver",
  receiptId: "demo_receipt_001",
};

const result = processEconomicEvent(demoEvent);

console.log(JSON.stringify(result, null, 2));
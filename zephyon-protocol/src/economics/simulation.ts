import type { PaymentEvent, EconomicResult } from "./types";
import { calculateProtocolFee } from "./feeEngine";
import { allocateRevenue } from "./revenueAllocator";

export function simulateEconomicEvent(event: PaymentEvent): EconomicResult {
  const fee = calculateProtocolFee(event.amountUsd, event.protocolFeeRate);
  const allocation = allocateRevenue(fee.protocolFeeUsd);

  return {
    event,
    fee,
    allocation,
  };
}

const demoEvent: PaymentEvent = {
  type: "P2P_PAYMENT_COMPLETED",
  amountUsd: 25,
  protocolFeeRate: 0.005,
  timestamp: new Date().toISOString(),
  sender: "demo_sender",
  receiver: "demo_receiver",
  receiptId: "demo_receipt_001",
};

const result = simulateEconomicEvent(demoEvent);

console.log(JSON.stringify(result, null, 2));
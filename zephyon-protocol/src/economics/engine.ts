import type { PaymentEvent, EconomicResult } from "./types";
import { calculateProtocolFee } from "./feeEngine";
import { allocateRevenue } from "./revenueAllocator";

export function processEconomicEvent(event: PaymentEvent): EconomicResult {
  const fee = calculateProtocolFee(event.amountUsd, event.protocolFeeRate);
  const allocation = allocateRevenue(fee.protocolFeeUsd);

  return {
    event,
    fee,
    allocation,
  };
}
import { calculateProtocolFee } from "./feeEngine";
import { applyEconomicPolicy } from "./policy";
import { allocateRevenue } from "./revenueAllocator";

import type {
  EconomicResult,
  PaymentEvent,
} from "./types";

export function processEconomicEvent(
  event: PaymentEvent
): EconomicResult {
  const policy = applyEconomicPolicy({
    eventType: event.type,
    baseProtocolFeeRate: event.protocolFeeRate,
  });

  const fee = calculateProtocolFee(
    event.amountUsd,
    policy.effectiveProtocolFeeRate
  );

  const allocation = allocateRevenue(
    fee.protocolFeeUsd
  );

  return {
    event: {
      ...event,
      protocolFeeRate: policy.effectiveProtocolFeeRate,
    },
    fee,
    allocation,
  };
}
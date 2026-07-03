import type { EconomicEventType, EconomicLedger } from "./economicLedger";

export type LedgerSummary = {
  totalEvents: number;
  totalRawVolume: number;
  byEventType: Record<EconomicEventType, number>;
};

export function summarizeLedger(ledger: EconomicLedger): LedgerSummary {
  const byEventType: Record<EconomicEventType, number> = {
    p2p_payment: 0,
    creator_tip: 0,
    merchant_purchase: 0,
    agent_payment: 0,
    protocol_test: 0,
  };

  const totalRawVolume = ledger.entries.reduce((total, entry) => {
    byEventType[entry.eventType] += 1;
    return total + entry.amountRaw;
  }, 0);

  return {
    totalEvents: ledger.entries.length,
    totalRawVolume,
    byEventType,
  };
}
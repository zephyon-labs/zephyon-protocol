export type EconomicEventType =
  | "p2p_payment"
  | "creator_tip"
  | "merchant_purchase"
  | "agent_payment"
  | "protocol_test";

export type EconomicLedgerEntryStatus = "simulated" | "failed" | "blocked";

export type EconomicLedgerEntry = {
  id: string;
  scenarioName: string;
  eventType: EconomicEventType;
  senderId: string;
  recipientId: string;
  recipientWallet: string;
  mint: string;
  amountRaw: number;
  status: EconomicLedgerEntryStatus;
  unitsConsumed?: number;
  timestamp: string;
};

export type EconomicLedger = {
  id: string;
  createdAt: string;
  environment: string;
  protocolVersion: string;
  entries: EconomicLedgerEntry[];
};

export function createEconomicLedger(environment = "unknown"): EconomicLedger {
  return {
    id: `ledger-${Date.now()}`,
    createdAt: new Date().toISOString(),
    environment,
    protocolVersion: "protocol-lab-v1",
    entries: [],
  };
}

export function recordEconomicEvent(
  ledger: EconomicLedger,
  entry: EconomicLedgerEntry
): void {
  ledger.entries.push(entry);
}

export function createEconomicEventId(
  scenarioName: string,
  index: number
): string {
  const normalizedScenario = scenarioName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return `${normalizedScenario}-${index + 1}`;
}
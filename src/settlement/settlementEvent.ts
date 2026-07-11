import type { IsoTimestamp } from "../shared/time";
import type { SettlementStatus } from "./settlementState";

export type SettlementEventType =
  | "settlement_created"
  | "settlement_submitted"
  | "settlement_confirming"
  | "settlement_settled"
  | "settlement_failed"
  | "settlement_reversed";

export type SettlementEvent = {
  id: string;
  settlementId: string;
  type: SettlementEventType;
  status: SettlementStatus;
  occurredAt: IsoTimestamp;
  externalReference?: string;
  metadata?: Record<string, unknown>;
};
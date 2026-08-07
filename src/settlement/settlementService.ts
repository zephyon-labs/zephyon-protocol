import type { SettlementState } from "./settlementState";

/** @deprecated Legacy synchronous settlement abstraction; use canonical rail reconciliation. */
export interface SettlementService {
  create(state: SettlementState): Promise<SettlementState>;
  update(state: SettlementState): Promise<SettlementState>;
  getById(id: string): Promise<SettlementState | undefined>;
}

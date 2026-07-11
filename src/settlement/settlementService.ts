import type { SettlementState } from "./settlementState";

export interface SettlementService {
  create(state: SettlementState): Promise<SettlementState>;
  update(state: SettlementState): Promise<SettlementState>;
  getById(id: string): Promise<SettlementState | undefined>;
}
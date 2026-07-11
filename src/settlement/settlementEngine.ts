import type { SettlementService } from "./settlementService";
import type { SettlementState } from "./settlementState";

export class SettlementEngine {
  constructor(private readonly service: SettlementService) {}

  async create(state: SettlementState): Promise<SettlementState> {
    return this.service.create(state);
  }

  async update(state: SettlementState): Promise<SettlementState> {
    return this.service.update(state);
  }

  async getById(id: string): Promise<SettlementState | undefined> {
    return this.service.getById(id);
  }
}
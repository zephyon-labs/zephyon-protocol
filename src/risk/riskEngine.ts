import type { PaymentIntent } from "../shared/paymentIntent";
import type { RiskDecision } from "./riskDecision";
import type { RiskService } from "./riskService";

export class RiskEngine {
  constructor(private readonly service: RiskService) {}

  async evaluate(intent: PaymentIntent): Promise<RiskDecision> {
    return this.service.evaluate(intent);
  }
}
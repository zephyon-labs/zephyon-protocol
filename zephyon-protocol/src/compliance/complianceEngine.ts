import type { PaymentIntent } from "../shared/paymentIntent";
import type { ComplianceDecision } from "./complianceDecision";
import type { ComplianceService } from "./complianceService";

export class ComplianceEngine {
  constructor(
    private readonly service: ComplianceService
  ) {}

  async evaluate(
    intent: PaymentIntent
  ): Promise<ComplianceDecision> {
    return this.service.evaluate(intent);
  }
}
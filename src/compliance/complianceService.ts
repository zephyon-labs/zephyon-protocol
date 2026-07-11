import type { PaymentIntent } from "../shared/paymentIntent";
import type { ComplianceDecision } from "./complianceDecision";

export interface ComplianceService {
  evaluate(intent: PaymentIntent): Promise<ComplianceDecision>;
}
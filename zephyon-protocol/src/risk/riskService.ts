import type { PaymentIntent } from "../shared/paymentIntent";
import type { RiskDecision } from "./riskDecision";

export interface RiskService {
  evaluate(intent: PaymentIntent): Promise<RiskDecision>;
}
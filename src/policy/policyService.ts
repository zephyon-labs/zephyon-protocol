import type { PolicyContext } from "./policyContext";
import type { PolicyDecision } from "./policyDecision";

export interface PolicyService {
  evaluate(context: PolicyContext): Promise<PolicyDecision>;
}

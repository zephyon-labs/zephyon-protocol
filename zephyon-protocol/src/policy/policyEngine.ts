import type { PolicyContext } from "./policyContext";
import type { PolicyDecision } from "./policyDecision";
import type { PolicyService } from "./policyService";

export class PolicyEngine {
  constructor(private readonly service: PolicyService) {}

  async evaluate(context: PolicyContext): Promise<PolicyDecision> {
    return this.service.evaluate(context);
  }
}

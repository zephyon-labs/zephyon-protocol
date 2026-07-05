import type { PolicyContext } from "./policyContext";

export type PolicyRuleSeverity =
  | "info"
  | "warning"
  | "blocking";

export type PolicyRuleResult = {
  passed: boolean;
  ruleId: string;
  severity: PolicyRuleSeverity;
  reason?: string;
};

export interface PolicyRule {
  id: string;
  description: string;
  evaluate(context: PolicyContext): PolicyRuleResult | Promise<PolicyRuleResult>;
}

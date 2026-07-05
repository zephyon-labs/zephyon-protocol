import type { IsoTimestamp } from "../shared/time";
import type { PolicyRuleResult } from "./policyRule";

export type PolicyDecisionStatus =
  | "approved"
  | "approved_with_warnings"
  | "manual_review"
  | "blocked";

export type PolicyDecision = {
  status: PolicyDecisionStatus;
  decidedAt: IsoTimestamp;
  results: PolicyRuleResult[];
  reason?: string;
};

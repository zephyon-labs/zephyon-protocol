import type { IsoTimestamp } from "../shared/time";

export type ComplianceDecisionStatus =
  | "approved"
  | "requires_kyc"
  | "requires_kyb"
  | "manual_review"
  | "blocked";

export type ComplianceDecisionReason =
  | "identity_not_verified"
  | "business_not_verified"
  | "sanctions_potential_match"
  | "risk_threshold_exceeded"
  | "jurisdiction_restricted"
  | "policy_violation"
  | "approved_by_policy";

export type ComplianceDecision = {
  status: ComplianceDecisionStatus;
  reason: ComplianceDecisionReason;
  decidedAt: IsoTimestamp;
  reviewerId?: string;
  notes?: string;
};
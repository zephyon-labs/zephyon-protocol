import type { TrustAssessment } from "./score";

export type TrustDecisionStatus =
  | "trusted"
  | "limited"
  | "review_required"
  | "restricted";

export type TrustDecision = {
  status: TrustDecisionStatus;
  assessment: TrustAssessment;
  decidedAt: string;
  reason?: string;
};
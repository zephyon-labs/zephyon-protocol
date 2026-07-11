import type { IsoTimestamp } from "../shared/time";
import type { RiskAssessment } from "./riskAssessment";

export type RiskDecisionStatus =
  | "approved"
  | "step_up_required"
  | "manual_review"
  | "hold"
  | "blocked";

export type RiskDecision = {
  status: RiskDecisionStatus;
  assessment: RiskAssessment;
  decidedAt: IsoTimestamp;
  reason?: string;
};
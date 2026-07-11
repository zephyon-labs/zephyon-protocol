import type { IsoTimestamp } from "../shared/time";
import type { RiskFactor } from "./riskFactors";

export type RiskLevel =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type RiskAssessment = {
  score: number;
  level: RiskLevel;
  assessedAt: IsoTimestamp;
  factors: RiskFactor[];
};
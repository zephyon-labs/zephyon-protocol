export enum TrustRiskLevel {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

export interface TrustScore {
  score: number;
  riskLevel: TrustRiskLevel;
  confidence: number;
  algorithmVersion: string;
  calculatedAt: string;
}
export enum TrustRiskLevel {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

export enum TrustMaturityLevel {
  NEW = "new",
  EMERGING = "emerging",
  ESTABLISHED = "established",
  VETERAN = "veteran",
}

export interface TrustAssessment {
  score: number;
  riskLevel: TrustRiskLevel;
  maturityLevel: TrustMaturityLevel;
  confidence: number;
  signalCount: number;
  explanation: string[];
  recommendations: string[];
  algorithmVersion: string;
  calculatedAt: string;
}
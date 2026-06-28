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

export interface TrustScore {
  score: number;
  riskLevel: TrustRiskLevel;
  maturityLevel: TrustMaturityLevel;
  confidence: number;
  signalCount: number;
  algorithmVersion: string;
  calculatedAt: string;
}
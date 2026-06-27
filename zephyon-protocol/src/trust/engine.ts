import { TrustEvidence } from "./evidence";
import { TrustScore, TrustRiskLevel } from "./score";

export function evaluateTrust(
  evidence: TrustEvidence
): TrustScore {
  const score = Math.min(evidence.signalCount, 100);

  return {
    score,
    riskLevel:
      score >= 80
        ? TrustRiskLevel.LOW
        : score >= 50
        ? TrustRiskLevel.MEDIUM
        : TrustRiskLevel.HIGH,
    confidence: Math.min(score / 100, 1),
    algorithmVersion: "1.0.0",
    calculatedAt: new Date().toISOString(),
  };
}
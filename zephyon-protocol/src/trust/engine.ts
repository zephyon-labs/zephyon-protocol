import { TrustEvidence } from "./evidence";
import {
  TrustAssessment,
  TrustMaturityLevel,
  TrustRiskLevel,
} from "./score";

const TRUST_ALGORITHM_VERSION = "1.0.0";

function calculateWeightedScore(evidence: TrustEvidence): number {
  const rawScore = evidence.signals.reduce((total, signal) => {
    return total + signal.confidenceWeight;
  }, 0);

  return Math.max(0, Math.min(rawScore, 100));
}

function determineMaturityLevel(signalCount: number): TrustMaturityLevel {
  if (signalCount >= 100) return TrustMaturityLevel.VETERAN;
  if (signalCount >= 50) return TrustMaturityLevel.ESTABLISHED;
  if (signalCount >= 10) return TrustMaturityLevel.EMERGING;
  return TrustMaturityLevel.NEW;
}

function determineRiskLevel(
  score: number,
  maturityLevel: TrustMaturityLevel
): TrustRiskLevel {
  if (maturityLevel === TrustMaturityLevel.NEW) {
    return TrustRiskLevel.MEDIUM;
  }

  if (score >= 80) return TrustRiskLevel.LOW;
  if (score >= 50) return TrustRiskLevel.MEDIUM;
  return TrustRiskLevel.HIGH;
}

function calculateConfidence(signalCount: number): number {
  return Math.min(signalCount / 100, 1);
}

function buildExplanation(
  evidence: TrustEvidence,
  maturityLevel: TrustMaturityLevel
): string[] {
  const explanation = [
    `${evidence.signalCount} trust signal(s) observed.`,
    `Participant maturity level is ${maturityLevel}.`,
  ];

  if (maturityLevel === TrustMaturityLevel.NEW) {
    explanation.push("Participant has limited history.");
  }

  explanation.push("No fraud or dispute signals are currently included in this assessment.");

  return explanation;
}

function buildRecommendations(
  maturityLevel: TrustMaturityLevel
): string[] {
  if (maturityLevel === TrustMaturityLevel.NEW) {
    return [
      "Continue building successful payment history.",
      "Complete verification when available.",
      "Avoid unresolved disputes.",
      "Maintain consistent account activity.",
    ];
  }

  return [
    "Maintain consistent positive activity.",
    "Keep verification status current.",
  ];
}

export function evaluateTrust(evidence: TrustEvidence): TrustAssessment {
  const score = calculateWeightedScore(evidence);
  const maturityLevel = determineMaturityLevel(evidence.signalCount);

  return {
    score,
    riskLevel: determineRiskLevel(score, maturityLevel),
    maturityLevel,
    confidence: calculateConfidence(evidence.signalCount),
    signalCount: evidence.signalCount,
    explanation: buildExplanation(evidence, maturityLevel),
    recommendations: buildRecommendations(maturityLevel),
    algorithmVersion: TRUST_ALGORITHM_VERSION,
    calculatedAt: new Date().toISOString(),
  };
}
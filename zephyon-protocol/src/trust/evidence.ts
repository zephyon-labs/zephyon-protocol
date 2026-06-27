import { TrustSignal, TrustSubjectType } from "./types";

export interface TrustEvidence {
  subjectId: string;
  subjectType: TrustSubjectType;
  signals: TrustSignal[];
  signalCount: number;
  generatedAt: string;
}

export function createTrustEvidence(
  subjectId: string,
  subjectType: TrustSubjectType,
  signals: TrustSignal[]
): TrustEvidence {
  return {
    subjectId,
    subjectType,
    signals,
    signalCount: signals.length,
    generatedAt: new Date().toISOString(),
  };
}
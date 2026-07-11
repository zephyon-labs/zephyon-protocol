import {
  TrustSignal,
  TrustSignalType,
  TrustSubjectType,
} from "./types";

interface CreateTrustSignalParams {
  subjectId: string;
  subjectType: TrustSubjectType;
  signalType: TrustSignalType;
  confidenceWeight: number;
  source: string;
  metadata?: Record<string, unknown>;
}

export function createTrustSignal(
  params: CreateTrustSignalParams
): TrustSignal {
  return {
    id: crypto.randomUUID(),
    subjectId: params.subjectId,
    subjectType: params.subjectType,
    signalType: params.signalType,
    timestamp: new Date().toISOString(),
    confidenceWeight: params.confidenceWeight,
    source: params.source,
    metadata: params.metadata,
  };
}
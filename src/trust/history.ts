import type { TrustAssessment } from "./score";
import type { TrustSubjectType } from "./types";

export type TrustHistoryEntry = {
  subjectId: string;
  subjectType: TrustSubjectType;
  assessment: TrustAssessment;
  recordedAt: string;
};

export type TrustHistory = {
  subjectId: string;
  subjectType: TrustSubjectType;
  entries: TrustHistoryEntry[];
  updatedAt: string;
};

export function createTrustHistory(
  subjectId: string,
  subjectType: TrustSubjectType,
  entries: TrustHistoryEntry[] = []
): TrustHistory {
  return {
    subjectId,
    subjectType,
    entries,
    updatedAt: new Date().toISOString(),
  };
}

export function appendTrustHistoryEntry(
  history: TrustHistory,
  assessment: TrustAssessment
): TrustHistory {
  return {
    ...history,
    entries: [
      ...history.entries,
      {
        subjectId: history.subjectId,
        subjectType: history.subjectType,
        assessment,
        recordedAt: new Date().toISOString(),
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

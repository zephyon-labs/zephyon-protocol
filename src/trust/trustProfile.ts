import type { TrustAssessment } from "./score";
import type { TrustSubjectType } from "./types";

export type TrustProfile = {
  subjectId: string;
  subjectType: TrustSubjectType;
  assessment: TrustAssessment;
  updatedAt: string;
};
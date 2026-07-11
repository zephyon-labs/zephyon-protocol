import type { TrustEvidence } from "./evidence";
import type { TrustDecision } from "./trustDecision";
import type { TrustProfile } from "./trustProfile";

export interface TrustService {
  evaluate(evidence: TrustEvidence): Promise<TrustDecision>;
  getProfile(subjectId: string): Promise<TrustProfile | undefined>;
}
import type { TrustEvidence } from "./evidence";
import type { TrustDecision } from "./trustDecision";
import type { TrustProfile } from "./trustProfile";
import type { TrustService } from "./trustService";

export class TrustEngine {
  constructor(private readonly service: TrustService) {}

  async evaluate(evidence: TrustEvidence): Promise<TrustDecision> {
    return this.service.evaluate(evidence);
  }

  async getProfile(subjectId: string): Promise<TrustProfile | undefined> {
    return this.service.getProfile(subjectId);
  }
}
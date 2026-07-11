import type { ParticipantIdentity } from "./participantIdentity";
import type { IdentityVerification } from "./identityVerification";
import type { IdentityService } from "./identityService";

export class IdentityEngine {
  constructor(
    private readonly service: IdentityService
  ) {}

  async verify(
    participant: ParticipantIdentity
  ): Promise<IdentityVerification> {
    return this.service.verify(participant);
  }
}

import type { ParticipantIdentity } from "./participantIdentity";
import type { IdentityVerification } from "./identityVerification";

export interface IdentityService {
  verify(
    participant: ParticipantIdentity
  ): Promise<IdentityVerification>;
}

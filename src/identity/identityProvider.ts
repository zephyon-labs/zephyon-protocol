import type { ParticipantIdentity } from "./participantIdentity";
import type { IdentityVerification } from "./identityVerification";

export interface IdentityProvider {
  verify(
    participant: ParticipantIdentity
  ): Promise<IdentityVerification>;
}

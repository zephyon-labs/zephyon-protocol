import type { VerifiedIdentity } from "./verifiedIdentity";

export type IdentityVerification = {
  identity: VerifiedIdentity;
  successful: boolean;
  referenceId?: string;
};

import type { IsoTimestamp } from "../shared/time";

export type VerificationLevel =
  | "none"
  | "basic"
  | "enhanced"
  | "business"
  | "institutional";

export type VerifiedIdentity = {
  level: VerificationLevel;
  verifiedAt?: IsoTimestamp;
  provider?: string;
};

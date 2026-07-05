import type { TrustSignal } from "./types";

export type TrustEventType =
  | "trust_signal_recorded"
  | "trust_profile_updated"
  | "trust_decision_created";

export type TrustEvent = {
  id: string;
  type: TrustEventType;
  subjectId: string;
  timestamp: string;
  signal?: TrustSignal;
  metadata?: Record<string, unknown>;
};
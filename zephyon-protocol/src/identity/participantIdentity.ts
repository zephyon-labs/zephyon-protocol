import type { IsoTimestamp } from "../shared/time";

export type ParticipantType =
  | "human"
  | "merchant"
  | "business"
  | "ai_agent"
  | "organization"
  | "treasury"
  | "system";

export type ParticipantIdentity = {
  id: string;
  participantType: ParticipantType;
  displayName?: string;
  createdAt: IsoTimestamp;
  metadata?: Record<string, unknown>;
};

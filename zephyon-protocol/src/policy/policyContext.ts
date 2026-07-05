import type { PaymentIntent } from "../shared/paymentIntent";

export type PolicyActorType =
  | "human"
  | "merchant"
  | "business"
  | "ai_agent"
  | "system";

export type PolicyContext = {
  intent: PaymentIntent;
  actorType: PolicyActorType;
  actorId?: string;
  environment?: string;
  requestedAt: string;
  metadata?: Record<string, unknown>;
};

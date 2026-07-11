import type { ComplianceDecision } from "../compliance";
import type { IdentityVerification, ParticipantIdentity } from "../identity";
import type { PolicyContext, PolicyDecision } from "../policy";
import type { RiskDecision } from "../risk";
import type { PaymentIntent } from "../shared/paymentIntent";
import type { IsoTimestamp } from "../shared/time";
import type { TrustDecision, TrustEvidence } from "../trust";

export type ExecutionContext = {
  requestId: string;
  requestedAt: IsoTimestamp;
  environment?: string;

  paymentIntent: PaymentIntent;

  participant?: ParticipantIdentity;
  policyContext?: PolicyContext;
  trustEvidence?: TrustEvidence;

  identity?: IdentityVerification;
  compliance?: ComplianceDecision;
  risk?: RiskDecision;
  policy?: PolicyDecision;
  trust?: TrustDecision;

  metadata?: Record<string, unknown>;
};
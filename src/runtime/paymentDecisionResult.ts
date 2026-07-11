import type { ComplianceDecision } from "../compliance";
import type { RiskDecision } from "../risk";
import type { PolicyDecision } from "../policy";
import type { TrustDecision } from "../trust";
import type { IdentityVerification } from "../identity";

export type PaymentDecisionStatus =
  | "approved"
  | "manual_review"
  | "blocked";

export type PaymentDecisionResult = {
  status: PaymentDecisionStatus;
  identity?: IdentityVerification;
  compliance?: ComplianceDecision;
  risk?: RiskDecision;
  policy?: PolicyDecision;
  trust?: TrustDecision;
  reason?: string;
};
import type { AssetIdentityV1, NetworkDomainV1 } from "../economic/assetIdentity";
import type { EconomicConsentV1, EconomicIntentEnvelopeV1, RuntimePolicyReferenceV1 } from "../economic/economicIntent";

export type RuntimeEvidenceClassV1 = "economic-consent" | "eligibility" | "destination" | "identity" | "compliance" | "risk" | "trust" | "mandate";
export type RuntimeEvidenceResourceV1 = "envelope" | "session" | "destination";
export type RuntimeRecipientKindV1 = "direct-wallet" | "resolved-identity";
export type RuntimeEvidenceRequirementV1 = Readonly<{
  evidenceClass: RuntimeEvidenceClassV1;
  sourceId: string;
  sourceVersion: string;
  resource: RuntimeEvidenceResourceV1;
}>;
export type RuntimePolicyProfileV1 = Readonly<{
  schema: "zephyon.runtime-policy-profile/v1";
  policyId: string;
  policyVersion: string;
  configurationVersion: string;
  configurationFingerprint: string;
  network: NetworkDomainV1;
  scope: RuntimePolicyReferenceV1["scope"];
  effectiveFrom: string;
  expiresAt: string;
  assets: readonly Readonly<{ asset: AssetIdentityV1; minAtomicUnits: string; maxAtomicUnits: string }>[];
  purposes: readonly EconomicIntentEnvelopeV1["purpose"]["kind"][];
  sourceModes: readonly EconomicIntentEnvelopeV1["source"]["mode"][];
  recipientVerifications: readonly EconomicIntentEnvelopeV1["recipient"]["verification"][];
  recipientKinds: readonly RuntimeRecipientKindV1[];
  requiredEvidence: readonly RuntimeEvidenceRequirementV1[];
}>;

export type RuntimeEvidenceV1 = Readonly<{
  schema: "zephyon.runtime-policy-evidence/v1";
  evidenceId: string;
  evidenceClass: RuntimeEvidenceClassV1;
  sourceId: string;
  sourceVersion: string;
  subjectId: string;
  resource: Readonly<{ kind: RuntimeEvidenceResourceV1; id: string; version: string }>;
  envelopeDigest: string;
  network: NetworkDomainV1;
  issuedAt: string;
  expiresAt: string;
  digest: string;
  reference: string;
  status: "satisfied" | "unsatisfied" | "unavailable" | "revoked";
  fact: Readonly<{ kind: "attestation" }> | Readonly<{ kind: "economic-consent"; consent: EconomicConsentV1 }> |
    Readonly<{ kind: "destination"; recipientKind: RuntimeRecipientKindV1; wallet: string; account: string }>;
}>;

/** SERVER COMPOSITION AUTHORITY, never supplied by a request. The callback must authenticate
 * the entire normalized record against accepted ingestion (e.g. a durable verified snapshot).
 * Field matching alone is not authentication. I/O happens here, never in evaluation. */
export type RuntimeEvidenceQualifierV1 = Readonly<{
  authorityId: string;
  authenticate(record: RuntimeEvidenceV1): Promise<boolean>;
}>;
export type RuntimePolicyAuthorityV1 = Readonly<{
  evaluatorId: string;
  evaluatorVersion: string;
  evidenceAuthorityId: string;
  expectedProfileDigest: string;
  configurationVersion: string;
  configurationFingerprint: string;
}>;
/** Supplied by trusted orchestration, including the authoritative clock and current session.
 * Neither the browser nor a provider token can select these values. */
export type RuntimePolicyContextV1 = Readonly<{
  evaluatedAt: string;
  network: NetworkDomainV1;
  session?: Readonly<{ id: string; version: string }>;
}>;

export const runtimePolicyRejectionCodesV1 = [
  "POLICY_NOT_EFFECTIVE", "POLICY_EXPIRED", "ENVELOPE_NOT_EFFECTIVE", "ENVELOPE_EXPIRED",
  "POLICY_REFERENCE_MISMATCH", "CONTEXT_NETWORK_MISMATCH", "NETWORK_NOT_PERMITTED", "ASSET_NOT_PERMITTED",
  "AMOUNT_NOT_PERMITTED", "PURPOSE_NOT_PERMITTED", "SOURCE_NOT_PERMITTED", "DESTINATION_NOT_QUALIFIED",
  "EVIDENCE_UNTRUSTED", "EVIDENCE_UNEXPECTED", "EVIDENCE_MISSING", "EVIDENCE_SOURCE_MISMATCH",
  "EVIDENCE_VERSION_MISMATCH", "EVIDENCE_NETWORK_MISMATCH", "EVIDENCE_SUBJECT_MISMATCH",
  "EVIDENCE_RESOURCE_MISMATCH", "EVIDENCE_ENVELOPE_MISMATCH", "EVIDENCE_NOT_EFFECTIVE",
  "EVIDENCE_EXPIRED", "EVIDENCE_REVOKED", "EVIDENCE_NOT_SATISFIED", "CONSENT_BINDING_MISMATCH",
  "CONSENT_TIME_INVALID", "RECIPIENT_KIND_NOT_PERMITTED",
] as const;
export type RuntimePolicyRejectionCodeV1 = typeof runtimePolicyRejectionCodesV1[number];
export type RuntimePolicyInputCodeV1 = "POLICY_INVALID" | "EVIDENCE_INVALID" | "EVIDENCE_QUALIFIER_REQUIRED" |
  "CONFIGURATION_INVALID" | "CONFIGURATION_MISMATCH" | "ENVELOPE_INVALID" | "CONTEXT_INVALID" |
  "DECISION_BINDING_INVALID" | "DECISION_NOT_CURRENT";
/** Invalid inputs cannot always supply a valid envelope digest; never invent one for an error. */
export class RuntimePolicyInputErrorV1 extends Error {
  constructor(readonly code: RuntimePolicyInputCodeV1) { super(code); this.name = "RuntimePolicyInputErrorV1"; }
}
export type RuntimePolicyDecisionV1 = Readonly<{
  schema: "zephyon.runtime-policy-decision/v1";
  decisionId: string;
  status: "APPROVED" | "REJECTED";
  envelopeDigest: string;
  runtimeReference: RuntimePolicyReferenceV1;
  policyId: string;
  policyVersion: string;
  profileDigest: string;
  configurationVersion: string;
  configurationFingerprint: string;
  evaluatorId: string;
  evaluatorVersion: string;
  evidenceAuthorityId: string;
  evidenceSetDigest: string;
  evidenceReferences: readonly Readonly<Pick<RuntimeEvidenceV1, "evidenceId" | "evidenceClass" | "sourceId" | "sourceVersion" | "digest" | "reference">>[];
  issuedAt: string;
  expiresAt: string;
  rejectionCodes: readonly RuntimePolicyRejectionCodeV1[];
}>;

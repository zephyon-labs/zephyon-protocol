import { createAssetIdentityV1, createNetworkDomainV1, sameNetworkV1 } from "../economic/assetIdentity";
import { authorizationBindingDigestV1, createEconomicIntentEnvelopeV1, type EconomicIntentEnvelopeV1, type RuntimeDecisionBindingV1 } from "../economic/economicIntent";
import { canonicalJsonV1, digest, freeze, hex, id, object, time } from "../economic/validation";
import { readRuntimeEvidenceSet, runtimeEvidenceAuthorityIdentity, type RuntimeEvidenceAuthorityV1, type RuntimeEvidenceSetV1 } from "./runtimeEvidenceV1";
import { RuntimePolicyInputErrorV1, runtimePolicyRejectionCodesV1, type RuntimePolicyAuthorityV1, type RuntimePolicyContextV1, type RuntimePolicyDecisionV1, type RuntimePolicyProfileV1, type RuntimePolicyRejectionCodeV1 } from "./runtimePolicyContractsV1";
import { check, createRuntimePolicyProfileV1, guarded, runtimePolicyProfileDigestV1 } from "./runtimePolicyValidationV1";

/** Pure decision primitive. No clock reads, random IDs, transport, default services or execution. */
export class RuntimePolicyEvaluatorV1 {
  readonly #profile: RuntimePolicyProfileV1;
  readonly #authority: RuntimePolicyAuthorityV1;
  readonly #evidenceAuthority: RuntimeEvidenceAuthorityV1;
  constructor(profile: RuntimePolicyProfileV1, authority: RuntimePolicyAuthorityV1, evidenceAuthority: RuntimeEvidenceAuthorityV1) {
    this.#profile = createRuntimePolicyProfileV1(profile);
    this.#authority = guarded("CONFIGURATION_INVALID", () => {
      const a = object(authority, ["evaluatorId", "evaluatorVersion", "evidenceAuthorityId", "expectedProfileDigest", "configurationVersion", "configurationFingerprint"]);
      return freeze({ evaluatorId: id(a.evaluatorId), evaluatorVersion: id(a.evaluatorVersion), evidenceAuthorityId: id(a.evidenceAuthorityId),
        expectedProfileDigest: hex(a.expectedProfileDigest), configurationVersion: id(a.configurationVersion), configurationFingerprint: hex(a.configurationFingerprint) });
    });
    if (this.#authority.expectedProfileDigest !== runtimePolicyProfileDigestV1(this.#profile) ||
      this.#authority.configurationVersion !== this.#profile.configurationVersion || this.#authority.configurationFingerprint !== this.#profile.configurationFingerprint)
      throw new RuntimePolicyInputErrorV1("CONFIGURATION_MISMATCH");
    if (runtimeEvidenceAuthorityIdentity(evidenceAuthority) !== this.#authority.evidenceAuthorityId)
      throw new RuntimePolicyInputErrorV1("EVIDENCE_QUALIFIER_REQUIRED");
    this.#evidenceAuthority = evidenceAuthority;
    Object.freeze(this);
  }
  evaluate(input: EconomicIntentEnvelopeV1, evidenceSet: RuntimeEvidenceSetV1, evaluation: RuntimePolicyContextV1): RuntimePolicyDecisionV1 {
    const e = guarded("ENVELOPE_INVALID", () => {
      // Reject accessors before obtaining the embedded asset. The canonical SDK still owns parsing.
      const raw = object(input, Object.keys(input)), amount = object(raw.amount, ["schema", "asset", "atomicUnits"]);
      return createEconomicIntentEnvelopeV1(input, createAssetIdentityV1(amount.asset));
    });
    const context = guarded("CONTEXT_INVALID", () => {
      const c = object(evaluation, ["evaluatedAt", "network"], ["session"]);
      const s = c.session === undefined ? undefined : object(c.session, ["id", "version"]);
      return { evaluatedAt: time(c.evaluatedAt), network: createNetworkDomainV1(c.network),
        ...(s ? { session: { id: id(s.id), version: id(s.version) } } : {}) };
    });
    const p = this.#profile, a = this.#authority, now = context.evaluatedAt, envelopeDigest = authorizationBindingDigestV1(e, e.amount.asset);
    const reasons = new Set<RuntimePolicyRejectionCodeV1>();
    const reject = (code: RuntimePolicyRejectionCodeV1, condition: boolean) => { if (condition) reasons.add(code); };
    reject("POLICY_NOT_EFFECTIVE", now < p.effectiveFrom); reject("POLICY_EXPIRED", now >= p.expiresAt);
    reject("ENVELOPE_NOT_EFFECTIVE", now < e.createdAt); reject("ENVELOPE_EXPIRED", now >= e.expiresAt);
    reject("POLICY_REFERENCE_MISMATCH", e.runtime.evidenceDigest !== a.expectedProfileDigest || e.runtime.policyVersion !== p.policyVersion || e.runtime.scope !== p.scope);
    reject("CONTEXT_NETWORK_MISMATCH", !sameNetworkV1(context.network, p.network));
    reject("NETWORK_NOT_PERMITTED", !sameNetworkV1(e.amount.asset.network, p.network));
    const rule = p.assets.find(r => canonicalJsonV1(r.asset) === canonicalJsonV1(e.amount.asset));
    reject("ASSET_NOT_PERMITTED", !rule);
    reject("AMOUNT_NOT_PERMITTED", !!rule && (BigInt(e.amount.atomicUnits) < BigInt(rule.minAtomicUnits) || BigInt(e.amount.atomicUnits) > BigInt(rule.maxAtomicUnits)));
    reject("PURPOSE_NOT_PERMITTED", !p.purposes.includes(e.purpose.kind));
    reject("SOURCE_NOT_PERMITTED", !p.sourceModes.includes(e.source.mode));
    reject("DESTINATION_NOT_QUALIFIED", !p.recipientVerifications.includes(e.recipient.verification));
    const snapshot = readRuntimeEvidenceSet(evidenceSet, this.#evidenceAuthority);
    reject("EVIDENCE_UNTRUSTED", !snapshot || snapshot.authorityId !== a.evidenceAuthorityId);
    const records = snapshot?.records ?? [];
    reject("EVIDENCE_UNEXPECTED", records.some(r => !p.requiredEvidence.some(requirement => requirement.evidenceClass === r.evidence.evidenceClass)));
    for (const requirement of p.requiredEvidence) {
      const item = records.find(r => r.evidence.evidenceClass === requirement.evidenceClass);
      if (!item) { reasons.add("EVIDENCE_MISSING"); continue; }
      const v = item.evidence;
      reject("EVIDENCE_UNTRUSTED", !item.authenticated);
      reject("EVIDENCE_SOURCE_MISMATCH", v.sourceId !== requirement.sourceId);
      reject("EVIDENCE_VERSION_MISMATCH", v.sourceVersion !== requirement.sourceVersion);
      reject("EVIDENCE_NETWORK_MISMATCH", !sameNetworkV1(v.network, p.network));
      reject("EVIDENCE_SUBJECT_MISMATCH", v.subjectId !== e.principal.id);
      reject("EVIDENCE_ENVELOPE_MISMATCH", v.envelopeDigest !== envelopeDigest);
      const resource = requirement.resource === "envelope" ? { id: e.attempt.intentId, version: e.attempt.intentVersion } :
        requirement.resource === "destination" ? { id: e.recipient.destinationBindingId, version: e.recipient.destinationVersion } : context.session;
      reject("EVIDENCE_RESOURCE_MISMATCH", !resource || v.resource.kind !== requirement.resource || v.resource.id !== resource.id || v.resource.version !== resource.version);
      reject("EVIDENCE_NOT_EFFECTIVE", now < v.issuedAt); reject("EVIDENCE_EXPIRED", now >= v.expiresAt);
      reject("EVIDENCE_REVOKED", v.status === "revoked"); reject("EVIDENCE_NOT_SATISFIED", v.status !== "satisfied" && v.status !== "revoked");
      if (v.fact.kind === "economic-consent") {
        const c = v.fact.consent;
        reject("CONSENT_BINDING_MISMATCH", c.principalId !== e.principal.id || c.envelopeDigest !== envelopeDigest);
        reject("CONSENT_TIME_INVALID", c.confirmedAt < e.createdAt || c.confirmedAt > now || c.confirmedAt > v.issuedAt);
      }
      if (v.fact.kind === "destination") {
        reject("DESTINATION_NOT_QUALIFIED", v.fact.wallet !== e.recipient.wallet || v.fact.account !== e.recipient.account);
        reject("RECIPIENT_KIND_NOT_PERMITTED", !p.recipientKinds.includes(v.fact.recipientKind));
      }
    }
    const rejectionCodes = runtimePolicyRejectionCodesV1.filter(code => reasons.has(code));
    return freeze({ schema: "zephyon.runtime-policy-decision/v1", decisionId: e.runtime.decisionId, status: rejectionCodes.length ? "REJECTED" : "APPROVED",
      envelopeDigest, runtimeReference: e.runtime, policyId: p.policyId, policyVersion: p.policyVersion, profileDigest: a.expectedProfileDigest,
      configurationVersion: p.configurationVersion, configurationFingerprint: p.configurationFingerprint, evaluatorId: a.evaluatorId, evaluatorVersion: a.evaluatorVersion,
      evidenceAuthorityId: a.evidenceAuthorityId, evidenceSetDigest: digest("zephyon:runtime-evidence-set:v1", snapshot ?? { authorityId: a.evidenceAuthorityId, records: [], unqualified: true }),
      evidenceReferences: records.map(({ evidence: v }) => ({ evidenceId: v.evidenceId, evidenceClass: v.evidenceClass, sourceId: v.sourceId, sourceVersion: v.sourceVersion, digest: v.digest, reference: v.reference })),
      issuedAt: now, expiresAt: [e.expiresAt, e.runtime.validUntil, p.expiresAt, ...records.map(r => r.evidence.expiresAt)].sort()[0], rejectionCodes });
  }
  /** Recompute against re-qualified evidence and the original evaluation context. Authenticity of
   * stored/transported decisions and fresh revocation snapshots remains an ingestion obligation.
   * Returns the unchanged V0.4 approval binding only after exact equality and current-time checks.
   * That legacy binding does NOT encode a shorter decision.expiresAt. Consumers must retain the
   * full decision and enforce its expiry, never widen it to runtimeReference.validUntil. */
  verifyDecision(decision: RuntimePolicyDecisionV1, envelope: EconomicIntentEnvelopeV1, evidenceSet: RuntimeEvidenceSetV1,
    originalContext: RuntimePolicyContextV1, now: string): RuntimeDecisionBindingV1 {
    const expected = this.evaluate(envelope, evidenceSet, originalContext);
    guarded("DECISION_BINDING_INVALID", () => check(expected.status === "APPROVED" && canonicalJsonV1(decision) === canonicalJsonV1(expected)));
    guarded("DECISION_NOT_CURRENT", () => { const at = time(now); check(at >= expected.issuedAt && at < expected.expiresAt); });
    return freeze({ schema: "zephyon.runtime-binding/v1", reference: expected.runtimeReference, envelopeDigest: expected.envelopeDigest, result: "approved" });
  }
}

import { createAssetIdentityV1, createNetworkDomainV1, sameNetworkV1 } from "../economic/assetIdentity";
import { canonicalJsonV1, choice, digest, freeze, hex, id, integer, key, literal, object, time } from "../economic/validation";
import { RuntimePolicyInputErrorV1, type RuntimeEvidenceV1, type RuntimePolicyInputCodeV1, type RuntimePolicyProfileV1 } from "./runtimePolicyContractsV1";

export function guarded<T>(code: RuntimePolicyInputCodeV1, action: () => T): T {
  try { return action(); } catch { throw new RuntimePolicyInputErrorV1(code); }
}
export function check(ok: unknown): asserts ok { if (!ok) throw new Error("Invalid policy contract."); }
export function list(value: unknown, max: number, min = 1): unknown[] {
  check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length >= min && value.length <= max);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(value).length === value.length + 1);
  for (let i = 0; i < value.length; i++) check(descriptors[i] && descriptors[i].enumerable && "value" in descriptors[i]);
  return value;
}
export function unique<T>(values: T[], identity: (v: T) => string): T[] {
  check(new Set(values.map(identity)).size === values.length);
  return values.sort((a, b) => identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0);
}
const classes = ["economic-consent", "eligibility", "destination", "identity", "compliance", "risk", "trust", "mandate"] as const;
const resources = ["envelope", "session", "destination"] as const;
const recipientKinds = ["direct-wallet", "resolved-identity"] as const;

/** Validates syntax and defensively freezes configuration; trusted composition must pin its digest. */
export function createRuntimePolicyProfileV1(input: unknown): RuntimePolicyProfileV1 {
  return guarded("POLICY_INVALID", () => {
    const v = object(input, ["schema", "policyId", "policyVersion", "configurationVersion", "configurationFingerprint", "network", "scope", "effectiveFrom", "expiresAt", "assets", "purposes", "sourceModes", "recipientVerifications", "recipientKinds", "requiredEvidence"]);
    const network = createNetworkDomainV1(v.network);
    const assets = unique(list(v.assets, 16).map(raw => {
      const a = object(raw, ["asset", "minAtomicUnits", "maxAtomicUnits"]);
      const asset = createAssetIdentityV1(a.asset), minAtomicUnits = integer(a.minAtomicUnits, true), maxAtomicUnits = integer(a.maxAtomicUnits, true);
      check(sameNetworkV1(asset.network, network) && BigInt(minAtomicUnits) <= BigInt(maxAtomicUnits));
      return { asset, minAtomicUnits, maxAtomicUnits };
    }), v => canonicalJsonV1(v.asset));
    const requiredEvidence = unique(list(v.requiredEvidence, 8).map(raw => {
      const r = object(raw, ["evidenceClass", "sourceId", "sourceVersion", "resource"]);
      const evidenceClass = choice(r.evidenceClass, classes), resource = choice(r.resource, resources);
      check(evidenceClass !== "economic-consent" || resource === "envelope");
      check(evidenceClass !== "destination" || resource === "destination");
      return { evidenceClass, sourceId: id(r.sourceId), sourceVersion: id(r.sourceVersion), resource };
    }), v => v.evidenceClass);
    // Every V1 payment admission has explicit consent and destination qualification requirements.
    // Additional identity/compliance/risk/trust/eligibility requirements are profile-selected.
    check(requiredEvidence.some(r => r.evidenceClass === "economic-consent") && requiredEvidence.some(r => r.evidenceClass === "destination"));
    const result: RuntimePolicyProfileV1 = {
      schema: literal(v.schema, "zephyon.runtime-policy-profile/v1"), policyId: id(v.policyId), policyVersion: id(v.policyVersion),
      configurationVersion: id(v.configurationVersion), configurationFingerprint: hex(v.configurationFingerprint), network,
      scope: choice(v.scope, ["production", "devnet-test-only"] as const), effectiveFrom: time(v.effectiveFrom), expiresAt: time(v.expiresAt), assets,
      purposes: unique(list(v.purposes, 3).map(x => choice(x, ["p2p", "creator-payment", "service-payment"] as const)), String),
      sourceModes: unique(list(v.sourceModes, 2).map(x => choice(x, ["external-wallet", "devnet-server"] as const)), String),
      recipientVerifications: unique(list(v.recipientVerifications, 2).map(x => choice(x, ["verified", "devnet-unverified"] as const)), String),
      recipientKinds: unique(list(v.recipientKinds, 2).map(x => choice(x, recipientKinds)), String), requiredEvidence,
    };
    check(result.effectiveFrom < result.expiresAt);
    canonicalJsonV1(result);
    return freeze(result);
  });
}
/** Evidence-summary commitment allocated before the existing envelope is frozen; not a new envelope digest. */
export function runtimePolicyProfileDigestV1(profile: RuntimePolicyProfileV1): string {
  return digest("zephyon:runtime-policy-profile:v1", createRuntimePolicyProfileV1(profile));
}

export function evidenceRecord(input: unknown): RuntimeEvidenceV1 {
  const v = object(input, ["schema", "evidenceId", "evidenceClass", "sourceId", "sourceVersion", "subjectId", "resource", "envelopeDigest", "network", "issuedAt", "expiresAt", "digest", "reference", "status", "fact"]);
  const r = object(v.resource, ["kind", "id", "version"]), evidenceClass = choice(v.evidenceClass, classes);
  let fact: RuntimeEvidenceV1["fact"];
  if (evidenceClass === "economic-consent") {
    const f = object(v.fact, ["kind", "consent"]), c = object(f.consent, ["schema", "consentId", "principalId", "envelopeDigest", "confirmedAt"]);
    fact = { kind: literal(f.kind, "economic-consent"), consent: {
      schema: literal(c.schema, "zephyon.economic-consent/v1"), consentId: id(c.consentId), principalId: id(c.principalId),
      envelopeDigest: hex(c.envelopeDigest), confirmedAt: time(c.confirmedAt),
    } };
  } else if (evidenceClass === "destination") {
    const f = object(v.fact, ["kind", "recipientKind", "wallet", "account"]);
    fact = { kind: literal(f.kind, "destination"), recipientKind: choice(f.recipientKind, recipientKinds), wallet: key(f.wallet), account: key(f.account) };
  } else {
    const f = object(v.fact, ["kind"]); fact = { kind: literal(f.kind, "attestation") };
  }
  const result: RuntimeEvidenceV1 = {
    schema: literal(v.schema, "zephyon.runtime-policy-evidence/v1"), evidenceId: id(v.evidenceId), evidenceClass,
    sourceId: id(v.sourceId), sourceVersion: id(v.sourceVersion), subjectId: id(v.subjectId),
    resource: { kind: choice(r.kind, resources), id: id(r.id), version: id(r.version) },
    envelopeDigest: hex(v.envelopeDigest), network: createNetworkDomainV1(v.network), issuedAt: time(v.issuedAt), expiresAt: time(v.expiresAt),
    digest: hex(v.digest), reference: id(v.reference), status: choice(v.status, ["satisfied", "unsatisfied", "unavailable", "revoked"] as const), fact,
  };
  check(result.issuedAt < result.expiresAt);
  return freeze(result);
}

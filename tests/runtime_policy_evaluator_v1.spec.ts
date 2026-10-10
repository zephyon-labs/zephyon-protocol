import { expect } from "chai";
import { readFileSync } from "node:fs";
import * as sdk from "../src";
import { canonicalJsonV1 } from "../src/economic/validation";

const fixture = JSON.parse(readFileSync("tests/fixtures/economic-intent-v1.json", "utf8"));
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const start = "2026-09-30T12:00:00.000Z", now = "2026-09-30T12:00:01.000Z", end = "2026-09-30T12:05:00.000Z";
const earlier = "2026-09-30T11:59:59.999Z", last = "2026-09-30T12:04:59.999Z";
const sources = { consent: { id: "test:consent-ingestion", version: "1" }, eligibility: { id: "test:canonical-eligibility", version: "1" }, destination: { id: "test:inventory", version: "1" } };
function profileInput(): sdk.ControlledDevnetTestPolicyInputV1 {
  return { qualifiedAsset: fixture.qualifiedAsset, policyVersion: "test-policy:1", configurationVersion: "configuration:1", configurationFingerprint: "ab".repeat(32),
    effectiveFrom: start, expiresAt: end, maxAtomicUnits: "2000000", sources };
}
function policy() { return sdk.createControlledDevnetTestPolicyV1(profileInput()); }
function authority(p: sdk.RuntimePolicyProfileV1): sdk.RuntimePolicyAuthorityV1 {
  return { evaluatorId: "test:runtime-service", evaluatorVersion: "0.5.0", evidenceAuthorityId: "test:qualified-ingestion", expectedProfileDigest: sdk.runtimePolicyProfileDigestV1(p),
    configurationVersion: p.configurationVersion, configurationFingerprint: p.configurationFingerprint };
}
function envelope(p = policy()): sdk.EconomicIntentEnvelopeV1 {
  const raw = copy(fixture.devnetEnvelope);
  raw.runtime = { ...raw.runtime, policyVersion: p.policyVersion, evidenceDigest: sdk.runtimePolicyProfileDigestV1(p), validFrom: start, validUntil: end };
  return sdk.createEconomicIntentEnvelopeV1(raw, raw.amount.asset);
}
function context(e = envelope()): sdk.RuntimePolicyContextV1 { return { evaluatedAt: now, network: e.amount.asset.network, session: { id: "session:one", version: "3" } }; }
function records(e = envelope(), p = policy()): sdk.RuntimeEvidenceV1[] {
  const envelopeDigest = sdk.authorizationBindingDigestV1(e, e.amount.asset);
  return p.requiredEvidence.map(r => ({
    schema: "zephyon.runtime-policy-evidence/v1", evidenceId: `evidence:${r.evidenceClass}`, evidenceClass: r.evidenceClass,
    sourceId: r.sourceId, sourceVersion: r.sourceVersion, subjectId: e.principal.id, envelopeDigest, network: e.amount.asset.network,
    resource: r.resource === "envelope" ? { kind: "envelope", id: e.attempt.intentId, version: e.attempt.intentVersion } : r.resource === "destination" ?
      { kind: "destination", id: e.recipient.destinationBindingId, version: e.recipient.destinationVersion } : { kind: "session", ...context(e).session! },
    issuedAt: now, expiresAt: end, digest: "cd".repeat(32), reference: `snapshot:${r.evidenceClass}:one`, status: "satisfied",
    fact: r.evidenceClass === "economic-consent" ? { kind: "economic-consent", consent: { schema: "zephyon.economic-consent/v1", consentId: "consent:one", principalId: e.principal.id, envelopeDigest, confirmedAt: now } } :
      r.evidenceClass === "destination" ? { kind: "destination", recipientKind: "direct-wallet", wallet: e.recipient.wallet, account: e.recipient.account } : { kind: "attestation" },
  }));
}
/** Offline ingestion double. Only exact, pre-admitted normalized snapshots authenticate.
 * This does not qualify a production evidence source. */
function qualifier(admitted: sdk.RuntimeEvidenceV1[], authorityId = "test:qualified-ingestion"): sdk.RuntimeEvidenceQualifierV1 {
  const snapshots = new Set(admitted.map(canonicalJsonV1));
  return { authorityId, async authenticate(record) { return snapshots.has(canonicalJsonV1(record)); } };
}
const admittedSnapshots = new Set<string>();
const trustedAuthority = sdk.createRuntimeEvidenceAuthorityV1({ authorityId: "test:qualified-ingestion", async authenticate(row) { return admittedSnapshots.has(canonicalJsonV1(row)); } });
async function trusted(rows: sdk.RuntimeEvidenceV1[]) {
  rows.forEach(row => admittedSnapshots.add(canonicalJsonV1(row)));
  return sdk.createRuntimeEvidenceSetV1(rows, trustedAuthority);
}
function inputError(action: () => unknown, code: sdk.RuntimePolicyInputCodeV1) {
  try { action(); expect.fail("Expected rejection"); } catch (error) { expect(error).instanceOf(sdk.RuntimePolicyInputErrorV1); expect((error as sdk.RuntimePolicyInputErrorV1).code).equal(code); }
}
async function evidenceError(raw: unknown, code = "EVIDENCE_INVALID") {
  try { await sdk.createRuntimeEvidenceSetV1(raw, sdk.createRuntimeEvidenceAuthorityV1(qualifier([]))); expect.fail("Expected rejection"); }
  catch (error) { expect(error).instanceOf(sdk.RuntimePolicyInputErrorV1); expect((error as sdk.RuntimePolicyInputErrorV1).code).equal(code); }
}

describe("Runtime policy evaluator V1", () => {
  it("approves exact qualified Devnet TEST evidence and returns the existing V0.4 binding", async () => {
    const p = policy(), e = envelope(p), rows = records(e, p), set = await trusted(rows), runtime = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority);
    const d = runtime.evaluate(e, set, context(e));
    expect(d.status).equal("APPROVED"); expect(d.rejectionCodes).deep.equal([]); expect(d.decisionId).equal(e.runtime.decisionId);
    expect(d.envelopeDigest).equal(sdk.authorizationBindingDigestV1(e, e.amount.asset)); expect(d.runtimeReference).deep.equal(e.runtime);
    expect(d.policyId).equal(p.policyId); expect(d.configurationFingerprint).equal(p.configurationFingerprint); expect(d.evidenceReferences).length(3);
    expect(d.expiresAt).equal(end); expect(d.issuedAt).equal(now); expect(Object.isFrozen(d.evidenceReferences[0])).equal(true);
    const binding = runtime.verifyDecision(d, e, set, context(e), last);
    const consent = rows.find(r => r.fact.kind === "economic-consent")!.fact;
    if (consent.kind !== "economic-consent") throw new Error("fixture");
    sdk.assertEconomicAuthorizationV1(e, consent.consent, binding, last);
    expect(binding.result).equal("approved");
  });
  it("is deterministic across reconstructed evaluators, reordered records and object keys", async () => {
    const p = policy(), e = envelope(p), rows = records(e, p);
    const reverse = (v: any): any => Array.isArray(v) ? v.map(reverse) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverse(x)])) : v;
    const a = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority).evaluate(e, await trusted(rows), context(e));
    const q = sdk.createRuntimePolicyProfileV1(reverse(p)), reordered = reverse([...rows].reverse());
    const b = new sdk.RuntimePolicyEvaluatorV1(q, authority(q), trustedAuthority).evaluate(reverse(e), await trusted(reordered), reverse(context(e)));
    expect(b).deep.equal(a); expect(JSON.stringify(b)).equal(JSON.stringify(a));
    const reconstructedAuthority = sdk.createRuntimeEvidenceAuthorityV1(qualifier(rows));
    const reconstructedSet = await sdk.createRuntimeEvidenceSetV1(rows, reconstructedAuthority);
    const reconstructed = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), reconstructedAuthority);
    expect(reconstructed.evaluate(e, reconstructedSet, context(e))).deep.equal(a);
  });
  const evidenceCases: [string, (rows: any[]) => void, sdk.RuntimePolicyRejectionCodeV1][] = [
    ["missing trusted consent", rows => rows.splice(rows.findIndex(r => r.evidenceClass === "economic-consent"), 1), "EVIDENCE_MISSING"],
    ["expired consent", rows => rows.find(r => r.evidenceClass === "economic-consent").expiresAt = now, "EVIDENCE_EXPIRED"],
    ["consent for another envelope", rows => rows.find(r => r.evidenceClass === "economic-consent").fact.consent.envelopeDigest = "ef".repeat(32), "CONSENT_BINDING_MISMATCH"],
    ["consent for another principal", rows => rows.find(r => r.evidenceClass === "economic-consent").fact.consent.principalId = "principal:other", "CONSENT_BINDING_MISMATCH"],
    ["consent before envelope", rows => rows.find(r => r.evidenceClass === "economic-consent").fact.consent.confirmedAt = earlier, "CONSENT_TIME_INVALID"],
    ["future consent", rows => rows.find(r => r.evidenceClass === "economic-consent").fact.consent.confirmedAt = end, "CONSENT_TIME_INVALID"],
    ["missing eligibility", rows => rows.splice(rows.findIndex(r => r.evidenceClass === "eligibility"), 1), "EVIDENCE_MISSING"],
    ["expired eligibility", rows => rows.find(r => r.evidenceClass === "eligibility").expiresAt = now, "EVIDENCE_EXPIRED"],
    ["revoked evidence", rows => rows[0].status = "revoked", "EVIDENCE_REVOKED"],
    ["unsatisfied evidence", rows => rows[0].status = "unsatisfied", "EVIDENCE_NOT_SATISFIED"],
    ["unavailable evidence", rows => rows[0].status = "unavailable", "EVIDENCE_NOT_SATISFIED"],
    ["wrong evidence source", rows => rows[0].sourceId = "source:other", "EVIDENCE_SOURCE_MISMATCH"],
    ["wrong evidence version", rows => rows[0].sourceVersion = "2", "EVIDENCE_VERSION_MISMATCH"],
    ["wrong evidence environment", rows => rows[0].network.environment = "testnet", "EVIDENCE_NETWORK_MISMATCH"],
    ["wrong evidence genesis", rows => rows[0].network.genesisHash = fixture.envelope.source.signer, "EVIDENCE_NETWORK_MISMATCH"],
    ["wrong subject", rows => rows[0].subjectId = "principal:other", "EVIDENCE_SUBJECT_MISMATCH"],
    ["wrong resource ID", rows => rows[0].resource.id = "resource:other", "EVIDENCE_RESOURCE_MISMATCH"],
    ["wrong resource version", rows => rows[0].resource.version = "2", "EVIDENCE_RESOURCE_MISMATCH"],
    ["wrong resource kind", rows => rows[0].resource.kind = "session", "EVIDENCE_RESOURCE_MISMATCH"],
    ["wrong evidence envelope", rows => rows[0].envelopeDigest = "ef".repeat(32), "EVIDENCE_ENVELOPE_MISMATCH"],
    ["future evidence", rows => rows[0].issuedAt = last, "EVIDENCE_NOT_EFFECTIVE"],
    ["unqualified destination", rows => rows.find(r => r.evidenceClass === "destination").status = "unsatisfied", "EVIDENCE_NOT_SATISFIED"],
    ["destination wallet substitution", rows => rows.find(r => r.evidenceClass === "destination").fact.wallet = fixture.envelope.source.signer, "DESTINATION_NOT_QUALIFIED"],
    ["destination token-account substitution", rows => rows.find(r => r.evidenceClass === "destination").fact.account = fixture.envelope.source.account, "DESTINATION_NOT_QUALIFIED"],
    ["username without supported canonical destination", rows => rows.find(r => r.evidenceClass === "destination").fact.recipientKind = "resolved-identity", "RECIPIENT_KIND_NOT_PERMITTED"],
  ];
  for (const [name, change, code] of evidenceCases) it(`rejects ${name} with stable code ${code}`, async () => {
    const p = policy(), e = envelope(p), rows = copy(records(e, p));
    // Begin before evaluation so exact expires-at == evaluation-time is a valid interval.
    rows.forEach(r => { (r as any).issuedAt = start; if (r.fact.kind === "economic-consent") (r.fact.consent as any).confirmedAt = start; });
    change(rows); const runtime = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority);
    const d = runtime.evaluate(e, await trusted(rows), context(e)); expect(d.status).equal("REJECTED"); expect(d.rejectionCodes).include(code);
    expect(d.rejectionCodes).deep.equal(sdk.runtimePolicyRejectionCodesV1.filter(c => d.rejectionCodes.includes(c)));
  });
  const envelopeCases: [string, (e: any) => void, sdk.RuntimePolicyRejectionCodeV1][] = [
    ["wrong network/genesis", e => { e.amount.asset.network.genesisHash = e.source.signer; e.fee.asset.network.genesisHash = e.source.signer; }, "NETWORK_NOT_PERMITTED"],
    ["wrong asset", e => e.amount.asset.mint = e.source.signer, "ASSET_NOT_PERMITTED"],
    ["excessive amount", e => e.amount.atomicUnits = "2000001", "AMOUNT_NOT_PERMITTED"],
    ["unsupported purpose", e => e.purpose.kind = "service-payment", "PURPOSE_NOT_PERMITTED"],
    ["changed policy version", e => e.runtime.policyVersion = "policy:other", "POLICY_REFERENCE_MISMATCH"],
    ["changed policy evidence summary", e => e.runtime.evidenceDigest = "ef".repeat(32), "POLICY_REFERENCE_MISMATCH"],
  ];
  for (const [name, change, code] of envelopeCases) it(`rejects ${name}`, async () => {
    const p = policy(), e = copy(envelope(p)); change(e); const runtime = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority);
    const d = runtime.evaluate(e, await trusted(records(e, p)), { ...context(e), network: p.network });
    expect(d.status).equal("REJECTED"); expect(d.rejectionCodes).include(code);
  });
  for (const amount of ["0", "-1", "01", "1.5", "1e9", "18446744073709551616", 1000000]) it(`rejects malformed canonical amount ${amount}`, async () => {
    const p = policy(), e: any = copy(envelope(p)); e.amount.atomicUnits = amount; const set = await trusted(records());
    inputError(() => new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority).evaluate(e, set, context()), "ENVELOPE_INVALID");
  });
  it("rejects an environment contradiction in the envelope without a made-up digest", async () => {
    const p = policy(), e = copy(envelope(p)), set = await trusted(records());
    (e.amount.asset.network as any).environment = "testnet"; (e.fee.asset.network as any).environment = "testnet";
    inputError(() => new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority).evaluate(e, set, context()), "ENVELOPE_INVALID");
  });
  it("checks authoritative context network and current session binding", async () => {
    const p = policy(), e = envelope(p), set = await trusted(records(e, p)), r = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority);
    expect(r.evaluate(e, set, { ...context(e), network: { ...p.network, environment: "testnet" } }).rejectionCodes).include("CONTEXT_NETWORK_MISMATCH");
    expect(r.evaluate(e, set, { ...context(e), session: { id: "session:other", version: "3" } }).rejectionCodes).include("EVIDENCE_RESOURCE_MISMATCH");
    expect(r.evaluate(e, set, { ...context(e), session: { id: "session:one", version: "4" } }).rejectionCodes).include("EVIDENCE_RESOURCE_MISMATCH");
    expect(r.evaluate(e, set, { evaluatedAt: now, network: p.network }).rejectionCodes).include("EVIDENCE_RESOURCE_MISMATCH");
  });
  it("cannot substitute a different valid source/recipient profile for the TEST authority", async () => {
    const p = policy(), raw = copy(fixture.envelope); raw.runtime = envelope(p).runtime;
    const e = sdk.createEconomicIntentEnvelopeV1(raw, raw.amount.asset), r = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority);
    const d = r.evaluate(e, await trusted(records(e, p)), context(e));
    expect(d.status).equal("REJECTED"); expect(d.rejectionCodes).include.members(["SOURCE_NOT_PERMITTED", "DESTINATION_NOT_QUALIFIED"]);
  });
  it("enforces policy, envelope and evidence exact time boundaries without renewal", async () => {
    const p = policy(), e = envelope(p), rows = records(e, p);
    rows.forEach(r => { (r as any).issuedAt = start; if (r.fact.kind === "economic-consent") (r.fact.consent as any).confirmedAt = start; });
    const set = await trusted(rows), runtime = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority);
    expect(runtime.evaluate(e, set, { ...context(e), evaluatedAt: start }).status).equal("APPROVED");
    expect(runtime.evaluate(e, set, { ...context(e), evaluatedAt: last }).status).equal("APPROVED");
    const expired = runtime.evaluate(e, set, { ...context(e), evaluatedAt: end });
    expect(expired.status).equal("REJECTED"); expect(expired.expiresAt).equal(end);
    expect(expired.rejectionCodes).include.members(["POLICY_EXPIRED", "ENVELOPE_EXPIRED", "EVIDENCE_EXPIRED"]);
    expect(runtime.evaluate(e, set, { ...context(e), evaluatedAt: earlier }).rejectionCodes).include.members(["POLICY_NOT_EFFECTIVE", "ENVELOPE_NOT_EFFECTIVE", "EVIDENCE_NOT_EFFECTIVE"]);
  });
  it("clips approval expiry to the earliest evidence deadline and rejects later verification", async () => {
    const p = policy(), e = envelope(p), rows = records(e, p), deadline = "2026-09-30T12:00:02.000Z";
    (rows[0] as any).expiresAt = deadline;
    const set = await trusted(rows), r = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority), d = r.evaluate(e, set, context(e));
    expect(d.expiresAt).equal(deadline);
    inputError(() => r.verifyDecision(d, e, set, context(e), deadline), "DECISION_NOT_CURRENT");
    inputError(() => r.verifyDecision(d, e, set, context(e), start), "DECISION_NOT_CURRENT");
  });
  it("rejects absent/mismatched configuration and has no default evaluator", () => {
    const p = policy();
    inputError(() => new sdk.RuntimePolicyEvaluatorV1(undefined as any, undefined as any, undefined as any), "POLICY_INVALID");
    inputError(() => new sdk.RuntimePolicyEvaluatorV1(p, undefined as any, trustedAuthority), "CONFIGURATION_INVALID");
    for (const change of [{ expectedProfileDigest: "ef".repeat(32) }, { configurationVersion: "2" }, { configurationFingerprint: "ef".repeat(32) }])
      inputError(() => new sdk.RuntimePolicyEvaluatorV1(p, { ...authority(p), ...change }, trustedAuthority), "CONFIGURATION_MISMATCH");
  });
  it("cannot replace required evidence with approve-all legacy results or caller-shaped objects", async () => {
    const p = policy(), e = envelope(p), r = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority);
    const empty = await trusted([]), approved = { status: "approved", policy: { status: "approved" } };
    for (const forged of [undefined, approved, records(e, p), { authorityId: "test:qualified-ingestion", records: records(e, p) }, {}]) {
      const d = r.evaluate(e, forged as any, context(e)); expect(d.status).equal("REJECTED"); expect(d.rejectionCodes).include("EVIDENCE_UNTRUSTED");
    }
    expect(r.evaluate(e, empty, context(e)).rejectionCodes).deep.equal(["EVIDENCE_MISSING"]);
    const set = await trusted(records(e, p));
    expect(r.evaluate(e, Object.create(Object.getPrototypeOf(set)), context(e)).status).equal("REJECTED");
    expect(r.evaluate(e, JSON.parse(JSON.stringify(set)), context(e)).status).equal("REJECTED");
    expect(() => new (set.constructor as any)({}, {})).to.throw("EVIDENCE_QUALIFIER_REQUIRED");
  });
  it("requires an ingestion qualifier and rejects failed/throwing/wrong-authority authentication", async () => {
    const p = policy(), e = envelope(p), rows = records(e, p), r = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority);
    try { await sdk.createRuntimeEvidenceSetV1(rows, undefined as any); expect.fail(); }
    catch (err) { expect((err as sdk.RuntimePolicyInputErrorV1).code).equal("EVIDENCE_QUALIFIER_REQUIRED"); }
    for (const q of [qualifier([], "test:qualified-ingestion"), qualifier(rows, "other:authority"), { authorityId: "test:qualified-ingestion", async authenticate() { throw Error("unavailable"); } }])
      expect(r.evaluate(e, await sdk.createRuntimeEvidenceSetV1(rows, sdk.createRuntimeEvidenceAuthorityV1(q)), context(e)).rejectionCodes).include("EVIDENCE_UNTRUSTED");
  });
  it("pins the exact ingestion capability, not a caller's matching authority ID", async () => {
    const p = policy(), e = envelope(p), rows = records(e, p), r = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority);
    const impostor = sdk.createRuntimeEvidenceAuthorityV1({ authorityId: authority(p).evidenceAuthorityId, async authenticate() { return true; } });
    const d = r.evaluate(e, await sdk.createRuntimeEvidenceSetV1(rows, impostor), context(e));
    expect(d.status).equal("REJECTED"); expect(d.rejectionCodes).include("EVIDENCE_UNTRUSTED");
    inputError(() => new sdk.RuntimePolicyEvaluatorV1(p, authority(p), undefined as any), "EVIDENCE_QUALIFIER_REQUIRED");
    inputError(() => new sdk.RuntimePolicyEvaluatorV1(p, authority(p), qualifier(rows) as any), "EVIDENCE_QUALIFIER_REQUIRED");
    inputError(() => sdk.createRuntimeEvidenceAuthorityV1({ authorityId: "test:qualified-ingestion" } as any), "EVIDENCE_QUALIFIER_REQUIRED");
  });
  it("does not approve failed authentication even at the pinned ingestion boundary", async () => {
    const p = policy(), e = envelope(p), rows = records(e, p);
    for (const authenticate of [async () => false, async () => { throw Error("source unavailable"); }, async () => ({ status: "approved" }) as any]) {
      const q = sdk.createRuntimeEvidenceAuthorityV1({ authorityId: authority(p).evidenceAuthorityId, authenticate });
      const r = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), q), d = r.evaluate(e, await sdk.createRuntimeEvidenceSetV1(rows, q), context(e));
      expect(d.status).equal("REJECTED"); expect(d.rejectionCodes).deep.equal(["EVIDENCE_UNTRUSTED"]);
    }
  });
  it("binds the qualified snapshot to all immutable envelope facts", async () => {
    const p = policy(), e = envelope(p), r = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority), set = await trusted(records(e, p));
    for (const change of [(x: any) => x.amount.atomicUnits = "1234568", (x: any) => x.purpose.reference = "payment:other",
      (x: any) => x.attempt.generation = "2", (x: any) => x.attempt.attemptId = "attempt:other", (x: any) => x.principal.id = "principal:other",
      (x: any) => x.recipient.destinationVersion = "2", (x: any) => x.source.bindingVersion = "2", (x: any) => x.fee.maxBaseFee = "10001"]) {
      const changed = copy(e); change(changed);
      expect(sdk.authorizationBindingDigestV1(changed, changed.amount.asset)).not.equal(sdk.authorizationBindingDigestV1(e, e.amount.asset));
      const d = r.evaluate(changed, set, context(e)); expect(d.status).equal("REJECTED"); expect(d.rejectionCodes).include("EVIDENCE_ENVELOPE_MISMATCH");
    }
  });
  it("authenticates the whole immutable record and cannot silently mutate after qualification", async () => {
    const p = policy(), e = envelope(p), rows = copy(records(e, p)), q = sdk.createRuntimeEvidenceAuthorityV1(qualifier(rows)), r = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), q);
    const set = await sdk.createRuntimeEvidenceSetV1(rows, q); (rows[0] as any).status = "revoked";
    expect(r.evaluate(e, set, context(e)).status).equal("APPROVED"); // snapshot is immutable; orchestration must re-qualify current state
    expect(r.evaluate(e, await sdk.createRuntimeEvidenceSetV1(rows, q), context(e)).rejectionCodes).include("EVIDENCE_UNTRUSTED");
    const current = sdk.createRuntimeEvidenceAuthorityV1(qualifier(rows));
    const currentRuntime = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), current);
    expect(currentRuntime.evaluate(e, await sdk.createRuntimeEvidenceSetV1(rows, current), context(e)).rejectionCodes).include("EVIDENCE_REVOKED");
  });
  it("rejects changed decision fields, stale/revoked evidence and attempted status promotion", async () => {
    const p = policy(), e = envelope(p), rows = records(e, p), set = await trusted(rows), r = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority), d = r.evaluate(e, set, context(e));
    for (const change of [{ decisionId: "other" }, { envelopeDigest: "ef".repeat(32) }, { evaluatorId: "other" }, { evidenceSetDigest: "ef".repeat(32) },
      { policyId: "other" }, { configurationVersion: "other" }, { expiresAt: "2027-01-01T00:00:00.000Z" }, { rejectionCodes: ["EVIDENCE_MISSING"] }, { extra: true }])
      inputError(() => r.verifyDecision({ ...d, ...change } as any, e, set, context(e), now), "DECISION_BINDING_INVALID");
    const revoked = copy(rows); (revoked[0] as any).status = "revoked"; const changedSet = await trusted(revoked);
    inputError(() => r.verifyDecision(d, e, changedSet, context(e), now), "DECISION_BINDING_INVALID");
    const rejected = r.evaluate(e, await trusted([]), context(e));
    inputError(() => r.verifyDecision({ ...rejected, status: "APPROVED", rejectionCodes: [] }, e, set, context(e), now), "DECISION_BINDING_INVALID");
  });
  it("rejects unexpected evidence and cannot use token fields to create approval", async () => {
    const p = policy(), e = envelope(p), rows = records(e, p), extra = { ...rows.find(r => r.evidenceClass === "eligibility")!, evidenceId: "extra", evidenceClass: "trust" as const };
    const r = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority);
    expect(r.evaluate(e, await trusted([...rows, extra]), context(e)).rejectionCodes).include("EVIDENCE_UNEXPECTED");
    await evidenceError([{ ...extra, zeraBalance: "1000000", zts: 100, zp: 100 }]);
    await evidenceError([{ ...extra, evidenceClass: "zera-stake" }]);
  });
  it("keeps generic logic independent of USDC and uses exact integer caps above 2^53", async () => {
    const raw: any = copy(policy()); raw.assets[0].asset.mint = fixture.envelope.source.signer; raw.assets[0].maxAtomicUnits = "9007199254740993"; raw.purposes = ["service-payment"];
    const p = sdk.createRuntimePolicyProfileV1(raw), e: any = copy(envelope(p)); e.amount.asset = copy(p.assets[0].asset); e.amount.atomicUnits = "9007199254740993"; e.purpose.kind = "service-payment";
    const r = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority); expect(r.evaluate(e, await trusted(records(e, p)), context(e)).status).equal("APPROVED");
    e.amount.atomicUnits = "9007199254740994"; expect(r.evaluate(e, await trusted(records(e, p)), context(e)).rejectionCodes).include("AMOUNT_NOT_PERMITTED");
  });
});

describe("Runtime V1 strict configuration and evidence contracts", () => {
  it("requires explicit bounded TEST cap, source inventory and exact qualified Devnet asset", () => {
    for (const change of [(v: any) => delete v.maxAtomicUnits, (v: any) => v.maxAtomicUnits = "0", (v: any) => v.qualifiedAsset.network.environment = "testnet",
      (v: any) => v.qualifiedAsset.mint = fixture.envelope.source.signer, (v: any) => v.qualifiedAsset.decimals = 9,
      (v: any) => v.qualifiedAsset.tokenProgram = fixture.envelope.source.signer, (v: any) => delete v.sources.eligibility]) {
      const v = copy(profileInput()); change(v); inputError(() => sdk.createControlledDevnetTestPolicyV1(v), "POLICY_INVALID");
    }
  });
  it("cannot define an empty approve-all profile or omit economic consent/destination", () => {
    for (const change of [(p: any) => p.requiredEvidence = [], (p: any) => p.requiredEvidence = p.requiredEvidence.filter((r: any) => r.evidenceClass !== "economic-consent"),
      (p: any) => p.requiredEvidence = p.requiredEvidence.filter((r: any) => r.evidenceClass !== "destination"), (p: any) => p.assets = [],
      (p: any) => p.purposes = [], (p: any) => p.recipientKinds = [], (p: any) => p.effectiveFrom = p.expiresAt,
      (p: any) => p.assets[0].minAtomicUnits = "2000001", (p: any) => p.requiredEvidence.push(p.requiredEvidence[0]),
      (p: any) => p.assets.push(p.assets[0]), (p: any) => p.schema = "future", (p: any) => p.extra = true]) {
      const v = copy(policy()); change(v); inputError(() => sdk.createRuntimePolicyProfileV1(v), "POLICY_INVALID");
    }
  });
  it("requires explicit trust evidence only when a future selected profile asks for it", async () => {
    const raw: any = copy(policy()); raw.requiredEvidence.push({ evidenceClass: "trust", sourceId: "test:trust", sourceVersion: "1", resource: "envelope" });
    const p = sdk.createRuntimePolicyProfileV1(raw), e = envelope(p), rows = records(e, p), r = new sdk.RuntimePolicyEvaluatorV1(p, authority(p), trustedAuthority);
    expect(r.evaluate(e, await trusted(rows.filter(x => x.evidenceClass !== "trust")), context(e)).rejectionCodes).include("EVIDENCE_MISSING");
    const trust = rows.find(x => x.evidenceClass === "trust")!; (trust as any).status = "unavailable";
    expect(r.evaluate(e, await trusted(rows), context(e)).rejectionCodes).include("EVIDENCE_NOT_SATISFIED");
  });
  it("rejects malformed, duplicate, oversized, accessor and contradictory evidence before qualification", async () => {
    const rows = records();
    for (const raw of [null, {}, [rows[0], rows[0]], Array(9).fill(rows[0]), [{ ...rows[0], schema: "future" }], [{ ...rows[0], digest: "bad" }],
      [{ ...rows[0], expiresAt: rows[0].issuedAt }], [{ ...rows[0], status: "approved" }], [{ ...rows[0], sourceVersion: "" }],
      [{ ...rows[0], fact: { kind: "attestation" } }], [{ ...rows[0], resource: { ...rows[0].resource, extra: true } }]]) await evidenceError(raw);
    let calls = 0; const getter = { ...rows[0], get sourceId() { calls++; throw Error("must not read"); } }; await evidenceError([getter]); expect(calls).equal(0);
    const array = [rows[0]]; Object.defineProperty(array, "0", { get() { calls++; throw Error("must not read"); }, enumerable: true }); await evidenceError(array); expect(calls).equal(0);
    const sparse = new Array(1); await evidenceError(sparse);
  });
  it("defensively copies profiles and rejects accessor configuration/context/envelopes", async () => {
    const raw: any = copy(policy()), p = sdk.createRuntimePolicyProfileV1(raw), a = authority(p), runtime = new sdk.RuntimePolicyEvaluatorV1(p, a, trustedAuthority), e = envelope(p), set = await trusted(records(e, p));
    raw.assets[0].maxAtomicUnits = "1"; (a as any).evaluatorId = "changed";
    expect(runtime.evaluate(e, set, context(e)).evaluatorId).equal("test:runtime-service");
    expect(p.assets[0].maxAtomicUnits).equal("2000000"); expect(Object.isFrozen(p.requiredEvidence[0])).equal(true);
    let calls = 0;
    inputError(() => sdk.createRuntimePolicyProfileV1({ ...raw, get network() { calls++; throw Error(); } }), "POLICY_INVALID");
    inputError(() => runtime.evaluate({ ...e, get amount(): never { calls++; throw Error(); } }, set, context(e)), "ENVELOPE_INVALID");
    inputError(() => runtime.evaluate(e, set, { ...context(e), get evaluatedAt(): never { calls++; throw Error(); } }), "CONTEXT_INVALID");
    expect(calls).equal(0);
  });
});

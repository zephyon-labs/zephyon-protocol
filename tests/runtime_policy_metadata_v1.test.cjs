'use strict';
// Ordinary JavaScript against the built package: TypeScript readonly declarations cannot help here.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const contracts = require('../dist/policy/runtimePolicyContractsV1.js');
const vocabulary = contracts.runtimePolicyRejectionCodesV1;
const originalDescriptor = Object.getOwnPropertyDescriptor(contracts, 'runtimePolicyRejectionCodesV1');
const coldReplacement = process.argv.includes('--replace-before-import');
if (coldReplacement) contracts.runtimePolicyRejectionCodesV1 = [];
const sdk = require('..');
const { canonicalJsonV1 } = require('../dist/economic/validation.js');
const fixture = require('./fixtures/economic-intent-v1.json');
const copy = value => JSON.parse(JSON.stringify(value));
const start = '2026-09-30T12:00:00.000Z', now = '2026-09-30T12:00:01.000Z', end = '2026-09-30T12:05:00.000Z';
const p = sdk.createControlledDevnetTestPolicyV1({
  qualifiedAsset: fixture.qualifiedAsset, policyVersion: 'test-policy:1',
  configurationVersion: 'configuration:1', configurationFingerprint: 'ab'.repeat(32),
  effectiveFrom: start, expiresAt: end, maxAtomicUnits: '2000000',
  sources: { consent: { id: 'test:consent-ingestion', version: '1' },
    eligibility: { id: 'test:canonical-eligibility', version: '1' }, destination: { id: 'test:inventory', version: '1' } },
});
const raw = copy(fixture.devnetEnvelope);
raw.runtime = { ...raw.runtime, policyVersion: p.policyVersion, evidenceDigest: sdk.runtimePolicyProfileDigestV1(p), validFrom: start, validUntil: end };
const e = sdk.createEconomicIntentEnvelopeV1(raw, raw.amount.asset);
const envelopeDigest = sdk.authorizationBindingDigestV1(e, e.amount.asset);
const context = { evaluatedAt: now, network: e.amount.asset.network, session: { id: 'session:one', version: '3' } };
const authority = {
  evaluatorId: 'test:runtime-service', evaluatorVersion: '0.5.0', evidenceAuthorityId: 'test:qualified-ingestion',
  expectedProfileDigest: sdk.runtimePolicyProfileDigestV1(p), configurationVersion: p.configurationVersion, configurationFingerprint: p.configurationFingerprint,
};
function records() {
  return p.requiredEvidence.map(r => ({
    schema: 'zephyon.runtime-policy-evidence/v1', evidenceId: `evidence:${r.evidenceClass}`, evidenceClass: r.evidenceClass,
    sourceId: r.sourceId, sourceVersion: r.sourceVersion, subjectId: e.principal.id, envelopeDigest, network: copy(e.amount.asset.network),
    resource: r.resource === 'envelope' ? { kind: 'envelope', id: e.attempt.intentId, version: e.attempt.intentVersion } : r.resource === 'destination' ?
      { kind: 'destination', id: e.recipient.destinationBindingId, version: e.recipient.destinationVersion } : { kind: 'session', ...context.session },
    issuedAt: start, expiresAt: end, digest: 'cd'.repeat(32), reference: `snapshot:${r.evidenceClass}:one`, status: 'satisfied',
    fact: r.evidenceClass === 'economic-consent' ? { kind: 'economic-consent', consent: { schema: 'zephyon.economic-consent/v1', consentId: 'consent:one', principalId: e.principal.id, envelopeDigest, confirmedAt: start } } :
      r.evidenceClass === 'destination' ? { kind: 'destination', recipientKind: 'direct-wallet', wallet: e.recipient.wallet, account: e.recipient.account } : { kind: 'attestation' },
  }));
}
const eligibility = rows => rows.find(r => r.evidenceClass === 'eligibility');
const destination = rows => rows.find(r => r.evidenceClass === 'destination');
const negativeCases = [
  ['missing consent', rows => rows.splice(rows.findIndex(r => r.evidenceClass === 'economic-consent'), 1), ['EVIDENCE_MISSING']],
  ['unqualified evidence', () => {}, ['EVIDENCE_UNTRUSTED', 'EVIDENCE_MISSING'], 'raw'],
  ['unauthenticated evidence', () => {}, ['EVIDENCE_UNTRUSTED'], 'unauthenticated'],
  ['all evidence missing', rows => { rows.length = 0; }, ['EVIDENCE_MISSING']],
  ['expired evidence', rows => { eligibility(rows).expiresAt = now; }, ['EVIDENCE_EXPIRED']],
  ['revoked evidence', rows => { eligibility(rows).status = 'revoked'; }, ['EVIDENCE_REVOKED']],
  ['wrong source', rows => { eligibility(rows).sourceId = 'source:other'; }, ['EVIDENCE_SOURCE_MISMATCH']],
  ['wrong version', rows => { eligibility(rows).sourceVersion = 'other'; }, ['EVIDENCE_VERSION_MISMATCH']],
  ['wrong environment', rows => { eligibility(rows).network.environment = 'testnet'; }, ['EVIDENCE_NETWORK_MISMATCH']],
  ['wrong envelope', rows => { eligibility(rows).envelopeDigest = 'ef'.repeat(32); }, ['EVIDENCE_ENVELOPE_MISMATCH']],
  ['wrong resource', rows => { eligibility(rows).resource.version = 'other'; }, ['EVIDENCE_RESOURCE_MISMATCH']],
  ['unqualified destination', rows => { destination(rows).fact.wallet = e.source.signer; }, ['DESTINATION_NOT_QUALIFIED']],
  ['multiple failures with exact precedence', rows => {
    rows.splice(rows.findIndex(r => r.evidenceClass === 'economic-consent'), 1);
    Object.assign(eligibility(rows), { sourceId: 'source:other', sourceVersion: 'other', expiresAt: now, status: 'revoked', envelopeDigest: 'ef'.repeat(32) });
    eligibility(rows).network.environment = 'testnet'; eligibility(rows).resource.version = 'other';
    destination(rows).fact.wallet = e.source.signer;
  }, ['DESTINATION_NOT_QUALIFIED', 'EVIDENCE_MISSING', 'EVIDENCE_SOURCE_MISMATCH', 'EVIDENCE_VERSION_MISMATCH',
    'EVIDENCE_NETWORK_MISMATCH', 'EVIDENCE_RESOURCE_MISMATCH', 'EVIDENCE_ENVELOPE_MISMATCH', 'EVIDENCE_EXPIRED', 'EVIDENCE_REVOKED']],
];
async function prepare(name, change, expectedReasons, mode) {
  const rows = records(); change(rows);
  // Offline exact-snapshot ingestion double only, never a real provider qualification.
  const snapshots = new Set(mode === 'unauthenticated' ? [] : rows.map(canonicalJsonV1));
  const evidenceAuthority = sdk.createRuntimeEvidenceAuthorityV1({ authorityId: authority.evidenceAuthorityId,
    async authenticate(record) { return snapshots.has(canonicalJsonV1(record)); } });
  const set = mode === 'raw' ? rows : await sdk.createRuntimeEvidenceSetV1(rows, evidenceAuthority);
  const runtime = new sdk.RuntimePolicyEvaluatorV1(p, authority, evidenceAuthority);
  const baseline = runtime.evaluate(e, set, context);
  assert.equal(baseline.status, expectedReasons.length ? 'REJECTED' : 'APPROVED', name);
  assert.deepEqual(baseline.rejectionCodes, expectedReasons, name);
  return { name, set, runtime, baseline, reconstruct: () => new sdk.RuntimePolicyEvaluatorV1(p, authority, evidenceAuthority) };
}
async function prepareMatrix() {
  const cases = await Promise.all(negativeCases.map(args => prepare(...args)));
  return { cases, positive: await prepare('valid TEST approval', () => {}, []) };
}
function bindingError(action, code = 'DECISION_BINDING_INVALID') {
  assert.throws(action, error => error instanceof sdk.RuntimePolicyInputErrorV1 && error.code === code);
}
function checkMatrix({ cases, positive }) {
  for (const { name, set, runtime, baseline, reconstruct } of cases) {
    const d = runtime.evaluate(e, set, context);
    assert.deepEqual(d, baseline, name);
    assert.equal(JSON.stringify(reconstruct().evaluate(e, set, context)), JSON.stringify(baseline), name);
    assert.equal(d.status, 'REJECTED', name);
    bindingError(() => runtime.verifyDecision(d, e, set, context, now));
    bindingError(() => runtime.verifyDecision({ ...d, status: 'APPROVED' }, e, set, context, now));
    bindingError(() => runtime.verifyDecision({ ...d, status: 'APPROVED', rejectionCodes: [] }, e, set, context, now));
  }
  const { set, runtime, baseline, reconstruct } = positive;
  assert.deepEqual(runtime.evaluate(e, set, context), baseline);
  assert.equal(JSON.stringify(reconstruct().evaluate(e, set, context)), JSON.stringify(baseline));
  assert.equal(baseline.status, 'APPROVED');
  assert.equal(runtime.verifyDecision(baseline, e, set, context, now).result, 'approved');
  for (const change of [
    { status: 'REJECTED' }, { rejectionCodes: ['EVIDENCE_MISSING'] }, { policyId: 'other' }, { policyVersion: 'other' },
    { profileDigest: 'ef'.repeat(32) }, { envelopeDigest: 'ef'.repeat(32) }, { evidenceSetDigest: 'ef'.repeat(32) },
    { evidenceReferences: [] }, { configurationFingerprint: 'ef'.repeat(32) }, { runtimeReference: { ...e.runtime, decisionId: 'other' } },
    { issuedAt: start }, { expiresAt: '2027-01-01T00:00:00.000Z' },
  ]) bindingError(() => runtime.verifyDecision({ ...baseline, ...change }, e, set, context, now));
  const changedEnvelope = copy(e); changedEnvelope.amount.atomicUnits = '1';
  bindingError(() => runtime.verifyDecision(baseline, changedEnvelope, set, context, now));
  bindingError(() => runtime.verifyDecision(baseline, e, cases[0].set, context, now));
  bindingError(() => runtime.verifyDecision(baseline, e, set, { ...context, session: { id: 'other', version: '3' } }, now));
  bindingError(() => runtime.verifyDecision(baseline, e, set, context, start), 'DECISION_NOT_CURRENT');
  bindingError(() => runtime.verifyDecision(baseline, e, set, context, end), 'DECISION_NOT_CURRENT');
}

if (coldReplacement) {
  // A fresh process changes the contract module before the evaluator is imported. This detects
  // fixes that merely capture/export-copy mutable metadata once during module initialization.
  prepareMatrix().then(matrix => { checkMatrix(matrix); console.log('Cold replacement: 13 negative cases and valid TEST approval passed'); })
    .catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const matrix = prepareMatrix();
  const rejectedMutations = [
    ['array clearing', () => { vocabulary.length = 0; }],
    ['push', () => vocabulary.push('OTHER')], ['pop', () => vocabulary.pop()], ['splice', () => vocabulary.splice(0)],
    ['shift', () => vocabulary.shift()], ['unshift', () => vocabulary.unshift('OTHER')],
    ['index assignment', () => { vocabulary[0] = 'OTHER'; }], ['index deletion', () => { delete vocabulary[0]; }],
    ['reverse', () => vocabulary.reverse()], ['sort', () => vocabulary.sort()], ['fill', () => vocabulary.fill('OTHER')],
    ['copyWithin', () => vocabulary.copyWithin(0, 1)],
    ['defineProperty', () => Object.defineProperty(vocabulary, '0', { value: 'OTHER' })],
    ['method override', () => { vocabulary.filter = () => []; }],
    ['prototype replacement', () => Object.setPrototypeOf(vocabulary, null)],
    ['public export replacement', () => { sdk.runtimePolicyRejectionCodesV1 = []; }],
    ['public export redefinition', () => Object.defineProperty(sdk, 'runtimePolicyRejectionCodesV1', { value: [] })],
  ];
  for (const [name, mutate] of rejectedMutations) test(`${name} is rejected; all decisions and verification remain unchanged`, async () => {
    const prepared = await matrix;
    assert.equal(Object.isFrozen(vocabulary), true);
    assert.throws(mutate, TypeError);
    checkMatrix(prepared);
  });
  test('sloppy JavaScript and Reflect mutation also leave the frozen vocabulary and decisions intact', async () => {
    const prepared = await matrix, before = [...vocabulary];
    Function('codes', 'codes.length = 0; codes[0] = "OTHER"; delete codes[1];')(vocabulary);
    assert.equal(Reflect.set(vocabulary, 'length', 0), false);
    assert.equal(Reflect.deleteProperty(vocabulary, '0'), false);
    assert.deepEqual(vocabulary, before);
    checkMatrix(prepared);
  });
  test('array spread, object spread and local copies can only change copies', async () => {
    const prepared = await matrix, before = [...vocabulary];
    const spread = [...vocabulary], local = vocabulary.slice(), objectSpread = { ...vocabulary }, namespaceCopy = { ...sdk };
    spread.length = 0; local.reverse(); delete objectSpread[0]; namespaceCopy.runtimePolicyRejectionCodesV1 = [];
    assert.notDeepEqual(local, vocabulary); assert.equal(spread.length, 0); assert.equal(objectSpread[0], undefined);
    assert.deepEqual(vocabulary, before);
    checkMatrix(prepared);
  });
  // The package root is a non-configurable getter, but the compiled internal CJS module has a
  // writable export slot. Poison it to prove the evaluator never reads even that metadata slot.
  const replacements = [
    ['empty export', { value: [] }], ['reversed export', { value: [...vocabulary].reverse() }],
    ['null export', { value: null }], ['throwing export getter', { get() { throw new Error('metadata read'); } }],
  ];
  for (const [name, descriptor] of replacements) test(`${name} on the internal CJS module cannot affect policy truth, order or verification`, async () => {
    const prepared = await matrix;
    try {
      Object.defineProperty(contracts, 'runtimePolicyRejectionCodesV1', { configurable: true, enumerable: true, ...descriptor });
      checkMatrix(prepared);
    } finally { Object.defineProperty(contracts, 'runtimePolicyRejectionCodesV1', originalDescriptor); }
  });
  test('metadata replacement before evaluator import cannot affect decisions', () => {
    const result = spawnSync(process.execPath, [__filename, '--replace-before-import'], { encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /Cold replacement: 13 negative cases and valid TEST approval passed/);
  });
}

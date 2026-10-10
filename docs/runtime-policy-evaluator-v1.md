# Runtime Policy Evaluator V1

This additive v0.5.0 candidate supplies the missing canonical economic admission primitive:

**Exact economic envelope + versioned policy + qualified evidence + authoritative time/context → APPROVED or REJECTED.**

`RuntimePolicyEvaluatorV1` evaluates explicit predicates. It does not call the legacy Runtime factory, construct transactions, contact providers, look up clocks, sign, submit, reconcile, or activate a payment route. Protocol remains the source of payment policy; Backend later supplies trusted orchestration and infrastructure adapters.

## Existing contracts and the new boundary

The evaluator reuses `AssetIdentityV1`, `EconomicAmountV1`, `EconomicIntentEnvelopeV1`, `authorizationBindingDigestV1` and `RuntimeDecisionBindingV1`. No asset identity, economic envelope or authorization digest is replaced. Parsing is not asset qualification: a trusted registry and composition root must select the profile's exact asset identities and configuration.

The generic profile describes one exact network/genesis domain, allowed assets with inclusive positive atomic min/max bounds, allowed purposes/source modes, destination verification/kind requirements, required evidence classes, effective/expiry times and policy/configuration identity. V1 supports at most 16 assets and 8 distinct required evidence classes. Values are copied, normalized, sorted and frozen. Unknown fields, accessors, duplicate classes/assets, sparse/extended arrays and contradictory ranges are rejected.

Every V1 payment policy explicitly requires economic consent and destination qualification. Other required classes are selected by the profile: eligibility, identity, compliance, risk, trust and mandate. These are bounded attestation classes, not provider implementations, scores, scripts or a rule language. An extension requiring new semantic predicates needs a new reviewed contract version. This is a payment-admission primitive over the existing envelope, not a universal policy DSL.

`runtimePolicyProfileDigestV1(profile)` commits to the normalized profile. Preparation must allocate the existing `envelope.runtime.evidenceDigest` to this profile summary **before freezing and confirming the envelope**. The existing policy version/scope must also match. The Runtime decision ID remains the envelope's preallocated ID. Nothing is renewed or substituted during evaluation. Older confirmed envelopes with a different summary must fail closed; Backend adoption must plan a fresh eligible preparation/consent rather than mutate them.

The policy-profile and evidence-set hashes are versioned commitments to their own records; the authorization digest remains exclusively `authorizationBindingDigestV1`. These commitments do not recursively include the final decision.

## Evidence is qualified outside the core

Evidence identifies its class, source ID/version, principal, exact envelope digest, resource kind/ID/version, network/genesis, issued/expiry times, digest/reference and disposition. All V1 admission evidence has an explicit expiry. Resource bindings target the intent/version, destination binding/version, or authoritative session/version. The envelope digest also binds payment purpose/reference, generation, attempt/fence, exact asset/atomic amount, source and destination.

Economic consent carries the existing `EconomicConsentV1`. Destination evidence attests the exact wallet/account and whether the recipient is a direct wallet or a resolved identity. Other classes attest a bounded `satisfied`, `unsatisfied`, `unavailable` or `revoked` result. There are no arbitrary authority-bearing metadata fields or free-form reasons. The record digest/reference identifies source evidence already authenticated by ingestion; its shape alone is not proof. The evidence-set commitment covers the entire normalized record and authentication result.

Trusted server composition creates one `RuntimeEvidenceAuthorityV1` capability with `createRuntimeEvidenceAuthorityV1`, backed by accepted ingestion. Its callback must authenticate the **entire normalized evidence record**, including all bindings, expiry and disposition, against an authenticated transport or durable verified snapshot. It must never approve merely because fields are well-shaped. The library cannot prove that an operator's callback is honest, nor sandbox a compromised composition root.

The evaluator pins that exact capability. A different capability using the same textual source ID cannot impersonate it. `createRuntimeEvidenceSetV1` validates records, calls only that configured authority and returns an opaque immutable set. Plain objects, JSON clones, prototype impersonation, failed authentication, thrown authentication calls and truthy non-boolean responses cannot grant authority. No mutable global registry or random identity is used. After process reconstruction, re-qualify persisted evidence using the new trusted composition's capability; do not deserialize a trusted set from a request.

The callback may perform I/O during ingestion. The core evaluation is synchronous and deterministic over its immutable profile, qualified snapshot, envelope and explicit context. Trusted source **qualification**, current database eligibility, revocation freshness, atomic snapshots and database-clock selection remain orchestration obligations. Holding an old opaque set does not magically observe a later revocation. Re-qualify current evidence before later use. Never let a browser select the qualifier, profile, authority configuration or evaluation clock.

## Fail closed and bounded decisions

Missing consent/destination/other required evidence, failed qualification, wrong class/source/version/network/subject/resource/envelope, premature/expired/revoked/unsatisfied/unavailable evidence and unpermitted economic facts cannot approve. Unexpected classes are rejected rather than silently influencing or being ignored by the decision. An empty profile is invalid; there is no approve-all default or fallback.

Well-formed inputs produce `RuntimePolicyDecisionV1`, with decision ID, APPROVED/REJECTED, exact envelope digest, original Runtime reference, policy ID/version/profile digest, configuration ID/version, evaluator ID/version, ingestion authority ID, evidence-set digest and bounded references, issued/expiry times and stable ordered rejection codes. Status derives exclusively from the internal predicate failure set: only an empty set permits APPROVED. A private immutable precedence table sorts every actual failure (maximum 28 unique codes), without filtering through public metadata. The runtime-frozen `runtimePolicyRejectionCodesV1` vocabulary documents the same order for consumers; its value is never read by evaluation or verification, including during module initialization. No free-form error string authorizes anything.

Inputs that cannot establish a valid canonical envelope/configuration/context or evidence record fail with `RuntimePolicyInputErrorV1.code`. For example, zero/noncanonical atomic amounts raise `ENVELOPE_INVALID`; malformed evidence fails ingestion with `EVIDENCE_INVALID`; missing profile/authority raises `POLICY_INVALID`, `CONFIGURATION_INVALID` or `EVIDENCE_QUALIFIER_REQUIRED`. The evaluator never invents a digest of malformed economics to make a decision look valid. Transport adapters must map these failures to truthful rejection/unavailability, never approval.

Time intervals are `[effective/issued, expires)`. Exact expiry rejects. Approval expiry is the minimum of envelope expiry, its Runtime reference validity, profile expiry and evidence expiries. Rejected diagnostic decisions can have an expiry at or before their evaluation time; they grant no usable authority. Evaluation does not renew a consent, policy, envelope or evidence record.

`verifyDecision` recomputes the exact decision from the original authoritative evaluation context and re-qualified evidence, requires APPROVED and exact canonical equality, and checks the supplied current authoritative time. It returns the **unchanged v0.4 `RuntimeDecisionBindingV1`**. Source authentication of a transported/stored decision and current profile/consent/session/account eligibility still belong to trusted ingestion/orchestration. A revoked or replaced evidence snapshot cannot verify the earlier decision. A revoked profile must be removed by trusted configuration selection; this pure SDK has no revocation service.

The returned legacy binding does not encode a decision expiry shorter than its preallocated Runtime reference. Consumers must retain the full V1 policy decision and enforce its `expiresAt`; they must not persist only the legacy binding or widen validity to `runtimeReference.validUntil`. A future adapter must intersect these bounds in durable evidence admission and recheck the decision before every use. The returned binding attests verification at the supplied time, not renewable execution authority.

Decision identity is preallocated, not generated. Different mutable inputs can produce different results for the same ID; the later durable Backend adapter must reject contradictory reissuance and recover immutable decisions. This SDK does not promise database idempotency, locking, replay recovery, or transaction authorization by itself.

## The one concrete profile: TEST / DEVNET ONLY

`createControlledDevnetTestPolicyV1` is the only shipped concrete profile. It requires:

- A registry-qualified Solana Devnet domain, canonical SPL Token program, six-decimal Devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- A positive explicitly configured atomic test cap; there is no default allowance.
- Current `devnet-server` authority, `p2p` purpose and `devnet-unverified` envelope representation.
- Independent TEST inventory evidence qualifying the exact direct-wallet destination; the historical envelope label alone does not qualify it.
- Exact trusted economic consent and current canonical session eligibility evidence from explicitly configured sources/versions.

The registry supplies the qualified genesis hash; this factory does not contact a chain or infer qualification from a known symbol/mint. Tests use the existing clearly synthetic offline genesis and dummy addresses. No production asset attestation is implied.

Username/resolved-identity recipients are rejected by this profile even if a wallet-shaped address is supplied. Canonical username→Solana destination qualification remains unavailable. No wallet guess or silent fallback exists.

USDC, Devnet and these source/purpose restrictions appear only in the supplied profile factory. Generic evaluator predicates compare values selected by the profile. Tests also exercise a different asset and purpose, including exact caps above `2^53`.

## Example (trusted server composition)

```ts
// These are previously qualified SERVER inputs, never request-body configuration.
const profile = createControlledDevnetTestPolicyV1(testInventoryConfiguration);
const profileDigest = runtimePolicyProfileDigestV1(profile);
// Preparation already committed profileDigest into envelope.runtime.evidenceDigest.
const ingestion = createRuntimeEvidenceAuthorityV1({
  authorityId: trustedAuthorityConfiguration.evidenceAuthorityId,
  authenticate: record => acceptedIngestion.authenticatesExactSnapshot(record),
});
const evaluator = new RuntimePolicyEvaluatorV1(
  profile,
  { ...trustedAuthorityConfiguration, expectedProfileDigest: profileDigest },
  ingestion,
);
const evidence = await createRuntimeEvidenceSetV1(authoritativeRecords, ingestion);
const decision = evaluator.evaluate(confirmedEnvelope, evidence, authoritativeContext);
// Later: reload current qualified profile/evidence and use the ORIGINAL context.
// A durable adapter must recover/conflict-check this decision ID, then recheck eligibility.
const binding = evaluator.verifyDecision(
  decision, confirmedEnvelope, evidence, authoritativeContext, authoritativeNow,
);
// STOP: binding is policy evidence, not transaction execution or signer authority.
```

No example callback approves unconditionally. The example references required ingestion and configuration components rather than pretending they are production implementations.

## Production, trust and token boundaries

No production profile or real KYC/AML/sanctions/fraud/risk/trust source is supplied or simulated. The generic profile contract can represent future qualified policy configuration; its syntax is not production readiness. No policy activation, SDK publication, Backend pin, Site change or deployment is included.

ZTS is not required by the TEST profile. A future profile requiring `trust` evidence must supply qualified evidence; unavailable trust remains unavailable. Trust evidence cannot substitute for required consent, destination, identity, compliance or risk classes. ZP != ZTS != ZERA. Token balances/staking/entitlements are not evaluator inputs and cannot purchase approval, identity, compliance, risk or trust exemptions. No ZP/ZERA mechanics or ZERA activation are added.

Authentication != economic consent != Runtime approval != wallet signature != sponsor authorization != settlement evidence. This evaluator manufactures none of those upstream/downstream facts. An approved Runtime decision still cannot execute a payment.

## Smoke inventory and compatibility

- `src/runtime/createPaymentRuntime.ts` supplies unconditional identity/compliance/risk/policy smoke producers and an internal-ledger composition. It is now explicitly documented TEST/SMOKE ONLY; behavior is unchanged.
- `PaymentDecisionPipeline` aggregates optional engines/results and can approve when evidence is absent. Its new warning documents that legacy behavior; it is not modified to serve as the V1 boundary.
- `scripts/smoke_test_payment_runtime*.ts` and other smoke/integration examples may use approving fixtures. They remain test examples.
- The inspected Backend legacy `src/services/payservice.ts` also has approving service fixtures; Backend synthetic authority tests use synthetic approval. Neither repository/code path is changed by this Protocol package.
- `RuntimeExecutionFacade` accepts already-approved evidence for execution orchestration; it is not the missing policy evaluator and is not called here.

No existing SDK export or contract is removed or changed. The new methods are additive; v0.4 envelope/hash vectors and existing Runtime behavior remain regression requirements. The proposed package version is 0.5.0; no tag, publication or push is authorized. Consumer migration order after independent review is Protocol release/pin, Backend adapter, then Site policy-state UX. The existing Vercel and Railway deployment holds remain in place; this package performs no hosting operations.

## Audit focus and remaining integration

Review capability pinning versus textual identity, whole-record ingestion assumptions, pre-consent profile commitment, exact resource/consent binding, half-open time intervals, stable rejection codes, decision recomputation and unchanged legacy APIs. Tests do not attest production ingress or databases.

Remaining work: qualified policy/evidence configuration, Backend durable approval/rejection ledger and concurrency/recovery, consent/account/session/revocation rechecks under authoritative locks/clock, authenticated service composition and truthful Site policy states. Username destination resolution remains a separate task. No transaction construction, signing, execution, Mainnet or ZERA work is required to review this primitive.

# Runtime Policy Evaluator V1 — independent audit handoff

Candidate: additive Protocol SDK v0.5.0, unpublished. Branch `feat/runtime-policy-evaluator-v1`; base `921628b0662b18ac33a7b4efc4094d57408b6e66`. Audited implementation `e87572ee7b8854ede5ff528cfcc4d6c6e747c46e` received **REVISE BEFORE RELEASE**, with POLICY-01 (P1) blocking. One local corrective commit follows that implementation. Exact corrective commit, corrective/combined patch SHA-256 values and validation-log hashes are supplied in `/tmp/runtime-policy-evaluator-v1-policy-01/candidate-manifest.json`, avoiding a self-referential patch fingerprint.

## Focused POLICY-01 re-audit

The audited evaluator filtered its actual failure set through an exported, runtime-mutable array, then derived status from the filtered length. Clearing that array suppressed all failures and allowed `verifyDecision` to accept the resulting incorrect approval. This was reproduced against a `git archive` of the exact audited commit. The historical script and output are preserved in `/tmp/runtime-policy-evaluator-v1-policy-01/historical-reproduction.cjs` and `historical-reproduction.log`; they are not a corrected-candidate acceptance test.

The correction derives status directly from `reasons.size`. It sorts the entire failure set using a private frozen, exhaustively typed precedence record; it never filters through or reads public rejection metadata. That metadata is a frozen flat tuple of primitive strings, so there are no nested mutable structures. The existing verification method recomputes corrected authoritative predicates, requires exact canonical equality (including status, reasons and policy/envelope/evidence/validity bindings), and checks current time. No verification gate or policy predicate is relaxed.

Review the two changed production files: `src/policy/runtimePolicyContractsV1.ts` and `src/policy/runtimePolicyEvaluatorV1.ts`. TEST policy, ingestion, asset/amount/environment/destination predicates, token firewall and smoke behavior are unchanged. The private precedence and public display tuple intentionally have separate storage; exhaustive typing covers every reason, while regression expectations preserve the established order. Public metadata cannot influence even evaluator initialization.

`tests/runtime_policy_metadata_v1.test.cjs` runs ordinary strict/sloppy JavaScript against a freshly built package through `npm run test:policy:metadata` (also in `test:ci`). Its 24 tests cover array mutation, public namespace replacement, copy mutation, internal CommonJS export poisoning and a fresh-process replacement before evaluator import. Every variant exercises 13 negative scenarios and a valid TEST approval, plus exact decision reproducibility and verification tampering. The internal CommonJS export slot remains replaceable but is semantically inert; the public root getter rejects replacement. This is not a sandbox against arbitrary replacement of executable code or JavaScript intrinsics.

Negative scenarios are missing consent, unqualified evidence, failed record authentication, all evidence missing, expired/revoked evidence, wrong source/version/environment/envelope/resource, unqualified destination and simultaneous failures with an exact nine-code order assertion. Rejected decisions and forged promotions cannot verify. Positive decisions reject forged status/reasons/policy/envelope/evidence/validity, wrong verification inputs and out-of-window verification. The TypeScript suite also tests an `any`-cast clearing attempt.

Historical evidence and corrected acceptance logs are separate. Independent confirmation of POLICY-01 closure is the next gate; no release is authorized by this handoff.

## Review scope

The package adds the missing generic policy primitive over the existing V1 economic envelope. It does not substitute policy in Backend, change Site, activate a payment rail, restore either deployment hold or publish an SDK.

Implementation:

- `runtimePolicyContractsV1.ts`: typed bounded profiles/evidence/authority/context/decisions and stable input/rejection codes.
- `runtimePolicyValidationV1.ts`: strict defensive validation and a profile commitment, using existing asset/network/canonical serialization helpers.
- `runtimeEvidenceV1.ts`: explicit ingestion authority capability and immutable qualified evidence set. Capability identity is pinned independently of its textual ID.
- `runtimePolicyEvaluatorV1.ts`: deterministic explicit admission predicates and later decision recomputation/freshness verification into the existing approval-binding contract.
- `controlledDevnetTestPolicyV1.ts`: exactly one concrete TEST/DEVNET ONLY USDC profile, configured cap and source inventory. No production policy.
- `runtime_policy_evaluator_v1.spec.ts`: positive, negative, boundary, provenance, deterministic, binding and exact-integer tests.

Existing Runtime code changes are documentation-only warnings on the legacy approving factory and optional-evidence aggregator. Existing economic contracts are untouched. Package metadata advances to 0.5.0 with no dependency changes. CI gains only explicit allowlist entries for the two newly shipped documentation files; its existing package path-security checks remain intact. The bounded CI script includes the new evaluator suite.

## Security/semantic review priorities

1. No field-shaped JSON or independently created matching-ID capability can substitute for the evaluator's pinned ingestion authority. Callback authenticity is a trusted server configuration obligation, not a library-provided provider attestation.
2. Entire evidence projections, including status and all bindings, must be authenticated. Production callback qualification remains open. Offline fixture callbacks prove software behavior only.
3. Every V1 profile explicitly requires economic consent and qualified destination evidence, plus its selected extra requirements. The TEST profile requires current canonical session eligibility. Empty configuration has no permissive default.
4. Pre-consent profile hash commitment, exact envelope digest, policy/config/source identity and evidence-set commitment remain distinct. No confirmed envelope can be rewritten after policy changes.
5. Consent, principal, intent/generation, destination and session-resource bindings fail closed. TEST identity recipients cannot be guessed into wallets.
6. Half-open validity windows use explicit authoritative time, minimum approval expiry and stable ordered rejection codes. Invalid envelope input fails with a bounded typed error, not a fabricated digest.
7. Verification recomputes a prior decision using current re-qualified evidence and the original context, then checks current time. The legacy binding cannot carry a shorter decision expiry; Backend must retain the full decision and intersect validity bounds, never widen them to the preallocated reference. Immutable snapshots do not automatically observe future revocation; that is an explicit Backend integration obligation.
8. Pure SDK decisions are not durable issuer records. Backend must still provide immutable decision-ID persistence, replay recovery, concurrency and consent/account/session/registry locks and rechecks.
9. No ZTS, ZP or ZERA input grants an exemption or creates identity/compliance/risk approval. No production compliance/trust truth is simulated.
10. No new core path can reach smoke producers, transaction construction, signing, submission or reconciliation. Existing legacy behavior is preserved.

## Validation

- Protocol build: passed.
- SDK typecheck (`tsc -p tsconfig.build.json --noEmit`): passed.
- Contract typecheck covering every SDK source file, existing economic tests and new evaluator tests: passed through `npm run test:policy`.
- Evaluator suite: 61 passing, zero failures/pending.
- Ordinary-JavaScript metadata suite: 24 passing, zero failures/skips, including the fresh-process import test.
- Bounded existing/new CI regression: 201 passing (116 existing + 61 evaluator + 24 JavaScript), zero failures/pending/skips.
- API compatibility: 454 v0.4 public declarations and 163 runtime exports unchanged; 23 additive declarations, eight runtime additions. All 477 declarations and 171 runtime exports from the audited v0.5 candidate are retained without signature changes. See `runtime-policy-evaluator-v1-api-diff.md`.
- Existing package-content allowlist, positive/negative/unicode path checks: passed; 798 packed files at verification.
- No standalone lint/format script is configured; `git diff --check` is required and passes.
- Unscoped `tsc --noEmit`: fails with 12 diagnostics in historical Anchor tests referencing missing generated `target/types/protocol` and consequent typing errors. An unchanged-base source snapshot, using the same dependencies and compiler, reproduces the exact same diagnostics byte-for-byte. No SDK/new-test diagnostic appears. No Anchor generation or validator run was performed for this TypeScript-only package.

During development, initial test type errors were corrected. One added mutation case initially assigned the already-existing fee value; it was changed to a real mutation and now asserts that the envelope digest actually changes before checking rejection. No product security assertion was weakened.

## Remaining gates and adoption

Independent Protocol audit is next. Production readiness is absent. A later authorized release and Backend pin must precede adapter adoption; Backend then implements durable evidence/decision recovery and eligibility checks, followed by truthful Site Runtime states. Qualified profile/evidence sources, policy lifecycle/revocation and username destination resolution remain concrete future work. Do not deploy or restore automatic deployment as part of this package.

Preserved boundaries: no Backend/Site source or dependency changes; no Mainnet contact; no live transaction construction/signing/broadcast; no funds movement; no ZERA activation. Existing offline Runtime/contract regressions retain their original fixture behavior.

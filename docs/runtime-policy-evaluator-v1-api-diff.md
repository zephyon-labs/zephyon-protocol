# v0.5.0 candidate public API additions

Compared with v0.4.0 at `921628b0662b18ac33a7b4efc4094d57408b6e66`: **454 existing public declarations and 163 runtime exports retained, zero removed or changed**. Declaration comparison uses the TypeScript compiler export graph and comment-free declaration text. Existing Runtime comments now warn about smoke behavior; signatures and behavior are unchanged.

Runtime additions:

- `RuntimePolicyEvaluatorV1`
- `RuntimePolicyInputErrorV1`
- `createControlledDevnetTestPolicyV1`
- `createRuntimeEvidenceAuthorityV1`
- `createRuntimeEvidenceSetV1`
- `createRuntimePolicyProfileV1`
- `runtimePolicyProfileDigestV1`
- `runtimePolicyRejectionCodesV1`

Type-only additions:

- `ControlledDevnetTestPolicyInputV1`
- `RuntimeEvidenceAuthorityV1`
- `RuntimeEvidenceClassV1`
- `RuntimeEvidenceQualifierV1`
- `RuntimeEvidenceRequirementV1`
- `RuntimeEvidenceResourceV1`
- `RuntimeEvidenceSetV1`
- `RuntimeEvidenceV1`
- `RuntimePolicyAuthorityV1`
- `RuntimePolicyContextV1`
- `RuntimePolicyDecisionV1`
- `RuntimePolicyInputCodeV1`
- `RuntimePolicyProfileV1`
- `RuntimePolicyRejectionCodeV1`
- `RuntimeRecipientKindV1`

The evaluator constructor requires a validated profile, pinned authority/configuration and the exact evidence-ingestion capability. Its `evaluate` method consumes the existing envelope, an opaque qualified set and explicit authoritative context. `verifyDecision` recomputes the decision and returns the existing `RuntimeDecisionBindingV1` after current-time validation. There is no default configuration, trust source or approve-all service.

No subpath exports, dependency versions, existing schema meanings or authorization digests change. Internal parsing helpers and capability accessors are not exported at the package root. New documentation files are added explicitly to the existing package-content allowlist.

## POLICY-01 correction

Compared with audited candidate `e87572ee7b8854ede5ff528cfcc4d6c6e747c46e`, all 477 public declarations and 171 runtime exports are retained with no declaration/signature change. `Object.freeze` preserves the exact readonly rejection-code tuple type while enforcing it at runtime. Attempts to mutate that tuple now throw in strict JavaScript or fail without changing it in sloppy JavaScript. Replacement of the internal CommonJS metadata export cannot influence evaluation or verification. The evaluator has no runtime dependency on that vocabulary; its internal immutable precedence preserves the original order. No new public API is added by the correction.

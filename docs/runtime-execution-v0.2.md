# Runtime execution architecture (v0.2)

The Runtime owns validation and deterministic economic execution semantics. The backend owns authorization, durable execution state, attempts, leases, scheduling, retries, reconciliation timing, and atomic receipt persistence.

The canonical flow is `CanonicalExecutionContext` → `RuntimeExecutionFacade` → `CanonicalPaymentRailAdapter` → typed submission/reconciliation outcome → `SettlementObservation` → `RuntimeReceipt`. Preparation never submits. Submission may return accepted without settlement. Reconciliation never submits.

An error after provider contact may have begun is `unknown`, never failed. The caller must persist the provider idempotency key and reconciliation reference and reconcile. Automatic resubmission is safe only for explicitly pre-contact failures.

Amounts and blockchain quantities cross public boundaries as canonical decimal integer strings. Native `bigint` or `BN` may be used internally but must not be serialized.

Adapters accept only `RailExecutionCommand`, preserve its rail, amount and destination, and provide stable reconciliation identity. Rail-specific proof is versioned `RailEvidence`; generic receipts do not require Solana fields.

`DeterministicMockRailAdapter` is network-free simulation infrastructure. `CanonicalSolanaPaymentRailAdapter` uses an injected transport: preparation builds signed transaction material without submission; submission broadcasts that exact material; reconciliation queries its pre-derived signature. A missing signature status remains pending. Only authoritative chain error evidence is failed. Signer/private-key material stays behind the transport and is never returned.

The canonical Solana adapter is not registered or activated automatically. This migration does **not** enable Solana Devnet settlement in ZephiPay, does not change `PAYMENTS_ENABLED`, and does not connect any backend or frontend execution path. Devnet activation requires a later, separately approved backend rollout after Mock Rail validation.

The v0.1 `PaymentRuntime.execute`, `PaymentOrchestrator`, `PaymentRailAdapter`, `SolanaPaymentAdapter`, `PaymentReceipt`, and settlement service/engine remain exported but are deprecated. They are compatibility APIs, not implementations of the canonical contract.

## zephipay-backend migration

1. Upgrade the SDK only after deploying the Runtime package.
2. Replace synchronous `PaymentRuntime.execute` orchestration with persisted backend execution records and explicit facade `prepareExecution`, `submitExecution`, and `reconcileExecution` calls.
3. Persist the prepared adapter payload, provider idempotency key, provider reference/reconciliation reference, outcome, observation, and attempt identity before scheduling subsequent work.
4. Convert raw numeric amounts to validated decimal integer strings before creating canonical contexts. Do not round through JavaScript `number`.
5. Replace legacy Solana-shaped receipts with `createRuntimeExecutionReceipt` after a settled observation; persist rail evidence alongside the canonical receipt.
6. Supply a Solana transport that constructs one signed transaction/signature before broadcast, broadcasts the same bytes, and queries status by that signature. Keep existing real-execution feature gates fail-closed.
   The Runtime `providerIdempotencyKey` identifies one backend execution attempt; Solana does not honor it as a provider idempotency key. The signed transaction signature is the replay/reconciliation identity. After provider contact might have occurred, do not build or broadcast a second transfer—query that signature instead.
7. Preserve v0.1 imports during staged migration, then remove deprecated use in a later coordinated release.

Deployment order: protocol v0.2 package → backend dependency update and migrations → Railway validation → frontend consumers. Repositories must not assume simultaneous deployment.

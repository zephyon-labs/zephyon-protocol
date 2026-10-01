# Mainnet P2P authority review — evidence and validation record

Recorded: 2026-09-30. Supports the
[ADR candidate](decisions/MAINNET_P2P_FUND_AUTHORITY_V1.md).
Read-only discovery of canonical checkouts; documentation changes confined to an
isolated Protocol worktree. This record is neither a deployed-system audit nor a
legal opinion. No secret files, hosted environment values, private keys, live
balances or chain transactions were inspected or exercised.

## Verified canonical state

All five checkouts were on clean `main`, equal to their local `origin/main` refs.
Read-only `git ls-remote origin refs/heads/main` also matched each exact commit.

| Repository | Canonical HEAD |
|---|---|
| zephyon-protocol | `0fdb559cf9ccacb439c5c763e5b986a523a427f6` |
| zephipay-backend | `dc0caa951da973adb52ea4fa36612a763ebad74a` |
| zephipay-site | `80883547ca42b83f8f80e417e733feeca9c11ae8` |
| zephipay-frontend | `5e16913a3dddf8c9157721e5481346365295df3c` |
| zephyon-zera | `237d9b774bb374fcfd389637ce3ab46fdbb81697` |

Canonical ZERA baseline digest remains
`182299950ae49c2bd2d8d5a99d2f73b3d0f77520982ab3c04ff8e2b9c1bbdff1`.

## Source evidence ledger

### E01 — Source and signer identity

The source must be the ATA derived from the configured signer and mint. This is an offline identity check; it does not establish funding provenance or account balance.

Source: [zephipay-backend/src/devnet/devnetPreparationPolicy.ts](https://github.com/zephyon-labs/zephipay-backend/blob/dc0caa951da973adb52ea4fa36612a763ebad74a/src/devnet/devnetPreparationPolicy.ts).

### E02 — Backend signer composition

Composes Runtime preparer, server signer, encrypted artifact persistence, Helius Devnet submission, separate reconciliation and recovery.

Source: [zephipay-backend/src/devnet/liveDevnetComposition.ts](https://github.com/zephyon-labs/zephipay-backend/blob/dc0caa951da973adb52ea4fa36612a763ebad74a/src/devnet/liveDevnetComposition.ts).

### E03 — Key-material boundary

Concrete adapter copies injected secret bytes into a Keypair and partially signs the Runtime-provided transaction. Actual hosted secret infrastructure is not inferred.

Source: [zephipay-backend/src/devnet/injectedDevnetSigner.ts](https://github.com/zephyon-labs/zephipay-backend/blob/dc0caa951da973adb52ea4fa36612a763ebad74a/src/devnet/injectedDevnetSigner.ts).

### E04 — Configuration capability gates

Configuration separates exposure/preparation/submission/reconciliation and accepts server-side signer and artifact-encryption inputs; values were not read.

Source: [zephipay-backend/src/devnet/devnetLiveConfiguration.ts](https://github.com/zephyon-labs/zephipay-backend/blob/dc0caa951da973adb52ea4fa36612a763ebad74a/src/devnet/devnetLiveConfiguration.ts).

### E05 — Exact transaction construction

Constructs one legacy Classic SPL transferChecked from configured source to recipient ATA, with signer also fee payer. Checks returned signed message against expected bytes. No ATA-create instruction is bundled.

Source: [zephyon-protocol/src/execution/referenceDevnetTransactionPreparer.ts](https://github.com/zephyon-labs/zephyon-protocol/blob/0fdb559cf9ccacb439c5c763e5b986a523a427f6/src/execution/referenceDevnetTransactionPreparer.ts).

### E06 — Exact Devnet shape

Permits exactly one transfer instruction and direct signer/fee-payer equality; not already compatible with a distinct sponsor or extra ATA/memo instructions.

Source: [zephyon-protocol/src/execution/devnetTransferCheckedValidation.ts](https://github.com/zephyon-labs/zephyon-protocol/blob/0fdb559cf9ccacb439c5c763e5b986a523a427f6/src/execution/devnetTransferCheckedValidation.ts).

### E07 — Durable orchestrator

Persists encrypted preparation; commitSubmission occurs before Runtime submission; exceptions become UNKNOWN. An old E2 no-submission class comment is historical: submitPrepared exists in this file.

Source: [zephipay-backend/src/devnet/devnetOrchestrationService.ts](https://github.com/zephyon-labs/zephipay-backend/blob/dc0caa951da973adb52ea4fa36612a763ebad74a/src/devnet/devnetOrchestrationService.ts).

### E08 — Atomic commitment

Existing commitment returns submissionAuthorized=false; only the new durable commitment winner receives submission permission. Committed records are not replacement candidates.

Source: [zephipay-backend/src/storage/postgres/postgresDevnetExecutionStateRepository.ts](https://github.com/zephyon-labs/zephipay-backend/blob/dc0caa951da973adb52ea4fa36612a763ebad74a/src/storage/postgres/postgresDevnetExecutionStateRepository.ts).

### E09 — Provider roles and finality

Single sendTransaction with maxRetries:0; independent getSignatureStatuses with searchTransactionHistory:true; confirmed/processed pending, finalized success/failure terminal, missing unknown.

Source: [zephipay-backend/src/adapters/solana/liveDevnetProviders.ts](https://github.com/zephyon-labs/zephipay-backend/blob/dc0caa951da973adb52ea4fa36612a763ebad74a/src/adapters/solana/liveDevnetProviders.ts).

### E10 — Reconciliation fencing

Read-only signature observation checks expected identity, history, context and finality. It neither prepares, signs, decrypts nor submits.

Source: [zephipay-backend/src/devnet/devnetReconciliationService.ts](https://github.com/zephyon-labs/zephipay-backend/blob/dc0caa951da973adb52ea4fa36612a763ebad74a/src/devnet/devnetReconciliationService.ts).

### E11 — Browser execution eligibility

Requires current account, beta allowlist, confirmed matching requestHash/version and bounded direct-wallet Devnet USDC. Constructs a bounded rail command; this is not proof of comprehensive Mainnet policy evidence.

Source: [zephipay-backend/src/devnet/browserDevnetExecution.ts](https://github.com/zephyon-labs/zephipay-backend/blob/dc0caa951da973adb52ea4fa36612a763ebad74a/src/devnet/browserDevnetExecution.ts).

### E12 — Evidence-bound receipt

Locks durable execution/preparation/commitment and matching finalized observation; rejects economics drift into UNKNOWN. Receipt sender is server-custodied-signer and settlement/receipt updates are transactional.

Source: [zephipay-backend/src/storage/postgres/postgresBrowserDevnetExecutionStore.ts](https://github.com/zephyon-labs/zephipay-backend/blob/dc0caa951da973adb52ea4fa36612a763ebad74a/src/storage/postgres/postgresBrowserDevnetExecutionStore.ts).

### E13 — Current recipient gap

Current destination resolution excludes REJECTED ownership; it does not require a verified ownership proof. Mainnet must not inherit this controlled-beta rule.

Source: [zephipay-backend/src/recipients/recipientDirectoryService.ts](https://github.com/zephyon-labs/zephipay-backend/blob/dc0caa951da973adb52ea4fa36612a763ebad74a/src/recipients/recipientDirectoryService.ts).

### E14 — Account mutation gap

write:account is a capability boundary, not destination proof; Mainnet recent-auth/step-up and ownership policy are explicitly open. Ordinary sessions still request write:payments.

Source: [zephipay-backend/docs/account-authorization-scopes.md](https://github.com/zephyon-labs/zephipay-backend/blob/dc0caa951da973adb52ea4fa36612a763ebad74a/docs/account-authorization-scopes.md).

### E15 — Runtime policy helper limit

Contains approving identity/compliance/risk/policy smoke services. Their presence is not evidence that live production checks exist, nor a claim that the browser Devnet path invokes every smoke service.

Source: [zephyon-protocol/src/runtime/createPaymentRuntime.ts](https://github.com/zephyon-labs/zephyon-protocol/blob/0fdb559cf9ccacb439c5c763e5b986a523a427f6/src/runtime/createPaymentRuntime.ts).

### E16 — Existing durable contract

Documents immutable signed artifacts, commitment before provider contact, single submission ownership, independent reconciliation and no replacement after possible submission.

Source: [zephyon-protocol/docs/devnet-durable-submission-contract.md](https://github.com/zephyon-labs/zephyon-protocol/blob/0fdb559cf9ccacb439c5c763e5b986a523a427f6/docs/devnet-durable-submission-contract.md).

### E17 — Phantom role

Explicit UI says Phantom is test-wallet context and does not sign the backend payment; connect/accountChanged/disconnect and balance reads are implemented.

Source: [zephipay-site/src/components/product/personal/DevnetTestBar.tsx](https://github.com/zephyon-labs/zephipay-site/blob/80883547ca42b83f8f80e417e733feeca9c11ae8/src/components/product/personal/DevnetTestBar.tsx).

### E18 — Active product availability

Controlled Devnet execution is enabled in source; new request mutations are unavailable. Hosted enablement still depends on deployment/configuration not inspected here.

Source: [zephipay-site/src/lib/round1Availability.ts](https://github.com/zephyon-labs/zephipay-site/blob/80883547ca42b83f8f80e417e733feeca9c11ae8/src/lib/round1Availability.ts).

### E19 — Authenticated active proxy

Uses application session and backend access-token authority for execution requests and maps authentication failures; source path is the current durable product integration.

Source: [zephipay-site/src/lib/paymentIntents/backendProxy.ts](https://github.com/zephyon-labs/zephipay-site/blob/80883547ca42b83f8f80e417e733feeca9c11ae8/src/lib/paymentIntents/backendProxy.ts).

### E20 — Current fixed asset client contract

Explicit solana-devnet/USDC status projection; not a Mainnet, customer-signing or general asset contract.

Source: [zephipay-site/src/lib/paymentIntents/devnetExecutionContract.ts](https://github.com/zephyon-labs/zephipay-site/blob/80883547ca42b83f8f80e417e733feeca9c11ae8/src/lib/paymentIntents/devnetExecutionContract.ts).

### E21 — Legacy product flow

Local simulation manufactures prototype balance changes and receipts; alternative path calls /api/send. Do not treat it as the authoritative durable P2P product.

Source: [zephipay-frontend/src/app/sending/page.tsx](https://github.com/zephyon-labs/zephipay-frontend/blob/5e16913a3dddf8c9157721e5481346365295df3c/src/app/sending/page.tsx).

### E22 — Legacy proxy

Forwards JSON to backend /api/send without the modern authenticated intent/execution contract.

Source: [zephipay-frontend/src/app/api/send/route.ts](https://github.com/zephyon-labs/zephipay-frontend/blob/5e16913a3dddf8c9157721e5481346365295df3c/src/app/api/send/route.ts).

### E23 — Mock/generic path scope

Generic execution worker is documented Mock-only and /api/send disabled with 410. This does not negate the separately implemented browser Devnet execution path.

Source: [zephipay-backend/docs/payment-execution.md](https://github.com/zephyon-labs/zephipay-backend/blob/dc0caa951da973adb52ea4fa36612a763ebad74a/docs/payment-execution.md).

### E24 — ZERA compatibility boundary

Requires explicit asset/mandate identity and authoritative evidence, but selects no wallet provider, signing design or ZERA route.

Source: [zephyon-zera/docs/optional-participation-integration-v1.md](https://github.com/zephyon-labs/zephyon-zera/blob/237d9b774bb374fcfd389637ce3ab46fdbb81697/docs/optional-participation-integration-v1.md).

## Current fund flow in twelve steps

1. Operator-arranged Circle Devnet USDC inventory is supplied through a configured
   source account. Actual faucet/deposit history is not proved by source inspection.
2. Source ATA is bound to the configured server signer; connected Phantom is not
   the source authority.
3. Key material may be injected into server memory; actual hosted custody is unknown.
4. Runtime prepares exact legacy transferChecked bytes and destination ATA.
5. Backend-injected signer signs, also as fee payer; Runtime checks returned bytes.
6. Backend/Runtime submits once through the configured Devnet provider.
7. Phantom supplies read-only connection/balance context.
8. The connected wallet grants no asset-transfer signature or custody delegation.
9. Encrypted signed artifact and signature are persisted; a separate atomic
   submission commitment precedes any possible provider contact.
10. Independent reconciliation queries the recorded signature with history enabled.
11. Missing/invalid/lost responses remain UNKNOWN; blockhash expiry after commitment
    does not authorize a fresh transaction.
12. A finalized observation matched to committed economics permits the durable
    Devnet receipt. It proves neither customer-wallet consent nor commercial delivery.

## External primary-source findings

Sources were checked during this review; revalidate transport/provider behavior
before implementation because SDK and mobile support can change. These are vendor
or standards claims, not independently tested provider-control guarantees.

- [Phantom signTransaction](https://docs.phantom.com/phantom-deeplinks/provider-methods/signtransaction): returns a signed serialized transaction and states it does not submit. The platform must still qualify partial-signature and process-death behavior.
- [Phantom deep links](https://docs.phantom.com/phantom-deeplinks/deeplinks-ios-and-android): documents iOS/Android universal-link integration; it is wallet-specific.
- [Phantom old sign-and-send deep link](https://docs.phantom.com/phantom-deeplinks/provider-methods/signandsendtransaction): marked deprecated; do not design a silent fallback around it.
- [Solana Mobile iOS guidance](https://docs.solanamobile.com/recipes/mobile-wallet-adapter/wallet-signing-on-ios): MWA unavailable on iOS; deep links do not provide the same persistent session/selection behavior. This does not erase Phantom's narrower vendor-specific API.
- [MWA reference](https://docs.solanamobile.com/get-started/react-native/mobile-wallet-adapter): capabilities and distinct sign-only/sign-and-send operations need separate handling.
- [Solana partial signing](https://solana.com/docs/core/transactions/partial-signing): all required signatures cover one frozen message. ADR sponsor-last safety is an architectural inference requiring its own durable release controls.
- [Solana confirmation](https://solana.com/developers/cookbook/transactions/confirmation) and [signature status RPC](https://solana.com/docs/rpc/http/getsignaturestatuses): lifetime and observation context matter. A null status does not establish comprehensive historical absence.
- [Solana ATA creation](https://solana.com/docs/tokens/basics/create-token-account): source/destination owner, creation payer and fee payer are distinct roles. The sponsor does not automatically receive a later rent refund.
- [Privy control model](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls) and [user-owner configurations](https://docs.privy.io/controls/authorization-keys/owners/configuration/user/overview): provider branding alone does not identify every party able to sign, reconfigure or recover.
- [Privy mobile export](https://docs.privy.io/recipes/mobile-key-export): export has platform/browser-context requirements; provider exit must be qualified rather than presumed.
- [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252) and [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700): native OAuth and modern authorization security; neither makes account login payment consent.

## Bounded architecture counterexample review

These are reasoning checks and future acceptance requirements, not executed wallet,
chain, provider or database integration tests.

| Counterexample | Required result in preferred profile |
|---|---|
| App dies after handoff is committed but before wallet opens | No sponsor signature; same durable attempt recovered or atomically cancelled before a new explicit review |
| Wallet signs, app dies before uploading result | Wallet outcome unknown; sponsor barrier prevents exact-message execution; cancellation must fence later callbacks |
| Cancellation races with user-signature upload/finalization | Exactly one durable generation transition wins; a cancellation winner denies all stale signing requests |
| Fee-signing request might have succeeded before response loss | FINALIZATION_COMMITTED freezes replacement; recover same operation/result, not a new message |
| Backend dies after submission commitment but before RPC | Retain reconciliation-only state even if liveness is lost; no owner reacquires first-send permission |
| RPC accepts, response lost, wallet later returns twice | One committed signature and receipt; callbacks/read retries do not create new execution |
| Old transaction expires and history returns null | UNKNOWN remains; no replacement based on elapsed time or missing status |
| Wallet switches account or changes fee payer | Reject mismatched message/signer; no automatic intent rewrite |
| Wallet injects extra transfer/approve/close instruction | Exact-message/shape validation fails before sponsor signing |
| Recipient changes primary address during signing | No redirection; revalidate original snapshot and invalidate uncommitted approval as required |
| Sponsor budget or policy service unavailable | No new executable capability; existing committed payments keep reconciliation |
| Provider silently signs-and-sends instead of signing only | Profile unsupported; conservative external-effect state, no automatic fallback |
| Account recovery succeeds but independent wallet is lost | Account access restored without wallet control; pending executions remain tracked |
| Second device requests replacement for unresolved obligation | Durable obligation/attempt lock rejects competing authorization, regardless of new request ID |

## Validation scope and commands

- `git branch --show-current`, `git rev-parse HEAD main origin/main`,
  `git --no-optional-locks status --porcelain=v2 --branch` in each canonical checkout.
- `git ls-remote origin refs/heads/main` in each of the five canonical repositories.
- Bounded `git ls-files`, `rg --files`, `rg -n`, `cat`, and `sed -n` inspections of
  the cited source/contract files; no `.env` or private key files were opened.
- Read-only official documentation browsing for mobile/signing, chain semantics,
  provider controls and native authentication. No vendor integration was installed.
- `git diff --check`, Markdown local-link/heading checks, exact changed-file/scope
  checks and end-state canonical cleanliness/baseline verification for this package.

No code/dependency/SDK/API/migration change is made. Runtime, chain, Anchor,
local-validator, corpus, frozen-LLM, deployment and value-bearing suites are not
appropriate to these documentation-only changes and were not run. Architecture
counterexamples above do not establish production enforcement or vendor readiness.

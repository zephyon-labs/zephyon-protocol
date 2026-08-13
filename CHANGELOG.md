# Changelog

## 0.3.0

- Added a provider-independent Solana Devnet transport with separately identified submission and reconciliation providers. Reconciliation uses the persisted signature and does not contact the submission provider.
- Added immutable Devnet prepared artifacts carrying the exact signed transaction bytes, SHA-256 digest, signature, signer key identity/version/public key, recent blockhash and expiry height, policy hash, authoritative SPL transfer values, and both provider identities.
- Added a reference Devnet preparer for a single, fail-closed SPL Token `transferChecked` transaction using an injected blockhash source and signer abstraction.
- Added strict validation of the exact signed transaction: canonical base64, cryptographically valid required signatures, fee-payer/authority consistency, SPL Token program, source account, mint, destination, raw amount, decimals, blockhash, signature, digest, and absence of unexpected instructions.
- Added the durable submission states and blockhash-expiry classification. Expiry before provider contact may start a fresh preparation lifecycle; expiry after submission commitment remains reconciliation-only.
- Hardened Solana reconciliation to derive identity from `reconciliationReference` and reject a conflicting `providerReference`. Consumers migrating from 0.2.0 must persist and supply the canonical `solana:<signature>` reconciliation reference.
- Extended the public Solana prepared-artifact types with Devnet signature, digest, signer, blockhash, policy, provider, decimals, and source-token-account metadata.

The backend owns durability and at-most-once invocation. It must durably persist the complete prepared artifact and commit `SUBMISSION_COMMITTED_RECONCILE_ONLY` before invoking Runtime submission. Once committed, that prepared transaction must never be automatically resubmitted; crashes, lost responses, timeouts, and missing observations recover only by reconciling the persisted signature. The Runtime validates the backend's commitment but does not implement the backend database transition itself.

## 0.2.0

- Added canonical exact-value execution contracts and recovery semantics.
- Added deterministic Mock and canonical Solana rail adapters.
- Added stateless prepare, submit, and reconcile Runtime operations.
- Added rail-independent settlement observations, events, evidence, and receipts.
- Deprecated legacy synchronous v0.1 execution APIs while retaining compatibility exports.

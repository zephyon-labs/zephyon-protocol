# Asset Identity and Economic Intent Compatibility V1

Status: implementation candidate for independent audit. SDK candidate: 0.4.0.
Base: Protocol `82862e2b28c15e05d95026b391df82092ce89805` after protected ADR closure.
No asset activation, signing service, wallet adapter, RPC, deployment or customer-fund execution.

## Authority and scope

The [Mainnet authority ADR](decisions/MAINNET_P2P_FUND_AUTHORITY_V1.md) was merged
through [PR 4](https://github.com/zephyon-labs/zephyon-protocol/pull/4), with independent
verdict ACCEPT WITH NONBLOCKING OBSERVATIONS. This package resolves P3-01 and
P3-02 at contract level. It does not qualify an operational signer, wallet or database.

Protocol owns identity, exact amounts, canonical economic envelopes, digest rules,
consent/policy bindings, authority vocabulary, offline transaction-profile checks,
signature inspection and pure attempt transitions. Backend owns adaptation of its
existing records and the future durable finalization repository contract.

Existing execution exports and behavior are unchanged. New exports live under
`src/economic`, available from the SDK root. Nothing invokes them from current
payment routes, preparation, submission, reconciliation or receipt production.
All approval-shaped evidence must come from a trusted authenticated issuer. Parsing
JSON or a typed `approved` field does not authenticate policy, ownership or consent.

## Asset Identity V1 and qualification

`zephyon.asset/v1` binds:

- Solana family; environment (`mainnet`, `devnet`, `testnet`, `localnet`, `custom`);
- full canonical 32-byte base58 genesis hash;
- `spl-token`: token program and mint, each canonical public-key encoding;
- `native`: `nativeId: sol`, nine decimals, no fictitious mint;
- verified precision, carried as bounded integer metadata.

No ticker, logo, URL or RPC hostname is authoritative identity. Compare every field
against a trusted qualified definition; equality never drops precision or program.
`assertQualifiedAssetV1` enforces exact comparison but does not create a registry or
fetch evidence. A future registry must bind qualified network/genesis, mint-account
owner/program, decimals, instruction profile, evidence freshness and activation
status. Client input cannot select that trusted argument. New identities parsing
successfully do not become supported payment assets.

A network label alone cannot qualify a domain. Infrastructure must establish and
check its actual genesis against the trusted definition before any later execution.
A localnet reset with another genesis is another domain. Same-genesis environment
aliases do not compare equal. No Mainnet mint or registry entry is introduced.
[Solana getGenesisHash](https://solana.com/docs/rpc/http/getgenesishash).

The fixture genesis and blockhash are **synthetic public values**, not a claim
about the real Devnet genesis. No chain was contacted to qualify this package.

## Economic Amount V1

`zephyon.amount/v1` pairs the full asset identity with positive `atomicUnits` as a
canonical decimal string, bounded by unsigned 64-bit SPL/native amount capacity.
No floats, exponent notation, signs, whitespace, leading zeroes or implicit scaling.
Six-decimal USDC remains six-decimal USDC; nine-decimal metadata is a mismatch,
not an instruction to multiply amounts. Fees/rent are separate native-SOL atomic
amounts. Invoice/display denomination and exchange rates are not settlement amount
fields and no conversion mechanism is implemented.

## Economic Intent Envelope V1

`zephyon.economic-intent/v1` contains:

| Group | Meaning |
|---|---|
| principal | Economic principal; optional consequential operator, role, mandate reference |
| attempt | Intent ID/version, attempt ID, monotonic generation, server fencing token |
| nonce / validity | Unique high-entropy server nonce, creation and expiry timestamps |
| source | Authority mode, signer, token account, binding ID/version |
| recipient | Immutable recipient snapshot/version, beneficiary, destination binding/version, wallet/token account and verification state |
| amount | Explicit qualified asset and positive atomic amount |
| fee | Separate fee mode/signer/key version, native asset, maximum base/priority/rent exposure and exact compute/ATA settings |
| purpose | P2P, creator payment or service payment; optional opaque order/request/service reference |
| runtime | Decision ID, policy version, evidence digest, validity and scope |

All identifiers are bounded ASCII machine references. Display names, descriptions,
login tokens, cookies, callback URLs, biometrics and private order text do not
belong in this envelope. Recipient asset/network context inherits the exact amount's
domain; the profile independently derives and verifies source/destination ATAs.
Changing a destination binding version changes authorization; no mutable directory
lookup can rewrite a frozen intent.

External-wallet profile requires distinct source and sponsor signers and verified
recipient binding. Devnet-server mode requires the same operational signer in both
roles, Devnet environment and explicit test-only policy scope. Source/fee role
separation therefore survives even where one current key performs both roles.

Optional operator/mandate references identify future evidence only. They do not
implement delegated signing. Future mandates still need asset/recipient permissions,
per-action and aggregate budgets, expiry/revocation, concurrency reservations and
signer qualification in a separately versioned extension. Human P2P needs none of
those optional references. Creator/provider references share the same contract;
fulfillment evidence remains separate from settlement.

## Exact canonical serialization and domain separation

Serialization version 1 is a **restricted canonical JSON subset**, not a claim
of general RFC 8785/JCS support:

1. Validate the exact versioned schema, required fields and unknown-field rejection.
2. Copy fields into immutable records. Only plain JSON objects, dense arrays, null,
   booleans, bounded printable ASCII strings and nonnegative safe integer metadata
   are serializable. Reject accessors, symbols, non-finite/fractional numbers and -0.
3. Sort object keys by ASCII code-unit order, ascending. Preserve array order.
4. Emit JSON with no whitespace. Escape quotation mark as `\"` and backslash as
   `\\`; allowed strings contain no control characters or non-ASCII Unicode.
5. Integers use base-10 digits without a sign or leading zeroes. Economic quantities,
   intent versions and generations are strings, not floating-point numbers.
6. Encode the resulting string as UTF-8, without BOM or final newline.

Raw JSON transport parsers must reject duplicate keys before supplying objects to
this API. This SDK does not accept raw JSON text or recover duplicate keys already
lost by a permissive parser. Unknown fields/versions fail; there is no best-effort
version downgrade. Unicode machine identifiers require a future explicit contract
rather than silent normalization. Private user-visible Unicode remains outside the
authorization envelope and may be referenced by an opaque identifier.

Authorization digest is lowercase 64-character hex:

`SHA-256(UTF8("zephyon:economic-envelope:v1\n") || canonicalEnvelopeUtf8)`.

Schema, purpose, full network/genesis and attempt are in the envelope, so a changed
purpose, environment, version or generation changes/rejects the binding. SHA-256
uses the existing Node crypto implementation; no custom cryptographic primitive.
Independent Python-generated canonical strings/hashes are checked by TypeScript
fixtures for both sponsored and Devnet-server representations.

## Consent, Runtime decision and hash-cycle avoidance

A session, connected wallet, customer confirmation record and transaction signature
are distinct facts. `EconomicConsentV1` binds consent ID, principal, envelope digest
and confirmation timestamp. `RuntimeDecisionBindingV1` binds an approved decision,
its versioned evidence reference and the same envelope digest. Verification checks
exact equality plus freshness; authenticity and risk/ownership qualification remain
trusted ingestion obligations.

Allocate the decision reference/evidence summary before freezing the envelope.
The final Runtime approval attests the resulting envelope digest separately; it is
not recursively included inside that envelope. Likewise, the envelope contains no
message digest. Build the future memo/message only after computing the envelope
hash, then bind its exact message digest in handoff/finalization records. Changing
material policy evidence or message preparation requires new review, not mutation
of an already signed envelope.

## Exact transaction-message identity and offline profile

Message digest:

`SHA-256(UTF8("zephyon:solana-message:v1\n") || exactSerializedMessageBytes)`.

This hashes Solana **message bytes**, not a JSON summary or signed transaction.
It includes fee payer, recent blockhash, all program/account indexes, account
permissions, instruction order/data and memo. It excludes signature slots.
It is deliberately distinct from the existing raw signed-artifact digest.

`zephyon.solana-sponsored-classic-spl/v1` is an offline, legacy-message profile:

1. Exactly one reviewed compute-unit limit instruction.
2. Exactly one reviewed compute-unit price instruction (zero is expressible).
3. Optional idempotent destination ATA creation funded by the sponsor.
4. Exactly one approved Memo program instruction containing only the 64-byte ASCII
   envelope digest, with no memo account arguments.
5. Exactly one Classic SPL `transferChecked` with direct user authority.

The pure profile oracle constructs expected bytes from bound economics. Validation
compares the complete serialized message, including compiled flags and all accounts.
No arbitrary client-built instruction is accepted merely because amount matches.
Token-2022, nonlegacy messages, durable nonces, multisig authorities, native transfers,
swaps, approval/delegation, authority changes, closure, extra programs, extra writable
accounts and extra/conflicting compute instructions require separate qualification.
These may be representable asset identities but are not this transaction profile.

Priority exposure uses exact integer ceiling `(units * microLamports + 999999) /
1000000` and must fit the consent bound. Compute units are bounded at 1,400,000.
Base-fee and rent amounts are maximum consent exposures, not claims about actual
chain pricing. Later preparation must obtain qualified account/fee evidence,
validate sufficiency and reserve exposure; this package does not price or fund fees.

No instruction is added to existing Devnet transfers. The exported oracle has no
RPC or signing dependency and is not connected to any execution path.

## Signature completeness and transaction ID

Signature inspection cryptographically verifies required Ed25519 slots over the
exact message and requires ordered `[sponsor, user]` signers:

- `CUSTOMER_ABSENT_SPONSOR_ABSENT`;
- `CUSTOMER_VERIFIED_SPONSOR_ABSENT`, with digest of verified user signature bytes;
- `FULLY_SIGNED`, with that digest and the first signature as final transaction ID.

Reject sponsor-first, substituted signers, altered messages or invalid signatures.
There is no verified final transaction ID before sponsor signing in this profile.
Never use the customer's partial signature for chain status lookup. Before that,
correlate intent, attempt, handoff, envelope/message and finalization identities.
[Solana transaction structure](https://solana.com/docs/core/transactions/transaction-structure).

Possible-effect certainty is independent: `IMPOSSIBLE` with a proof reference,
`UNESTABLISHED`, `MAY_HAVE_OCCURRED` with commitment reference, or `RESOLVED` with
finalized outcome evidence. A complete signature does not prove submission; missing
callback or elapsed time does not prove impossibility. Evidence parsers do not
validate the referenced evidence's authenticity.

## Attempt generation, cancellation and P3-01

Persist one active attempt/fence for the logical intent. Never reset its generation
by changing a request ID. A replacement requires a durably cancelled predecessor,
next generation, fresh attempt/fence identities and a new envelope/consent binding.
Existing finalization prevents cancellation/replacement. Renewal of blockhash or
wallet source changes exact message identity; it cannot reuse stale approval.

Pure transitions are contract functions, not concurrent persistence. The Backend
must atomically serialize current generation, cancellation, finalization and sponsor
exposure before the signing boundary. Stale local snapshots confer no authority.

`sponsorFinalizationId` is a server-generated UUIDv4, never a client-selected ID.
Its immutable tuple binds intent/version, attempt/generation/fence, full network,
exact message digest, ordered signers, user signer and verified signature digest,
sponsor public key/operational version, envelope/consent, Runtime reference and
reserved exposure identity. The tuple has a separate SHA-256 domain:
`zephyon:sponsor-finalization:v1\n` plus canonical tuple JSON.

Required persistence uniqueness: primary finalization ID and `(intentId,generation)`.
The latter deliberately excludes mutable intent version to avoid concurrent aliases.

| Request | Contract result |
|---|---|
| Same ID, identical tuple | Replay the same stored operation/result |
| Same ID, different tuple | Hard conflict |
| New ID, identical tuple at same generation | Converge on existing ID; no new operation |
| Competing tuple at same generation | Hard conflict |
| Cancelled/stale generation | Reject, even with a valid late user signature |
| Signer response unknown | Query/recover the same ID and immutable message; never replace by timeout |

`bindSponsorFinalizationV1` verifies offline consent/policy/message/signature
correlation before producing the tuple. The Backend pure claim function models
uniqueness/replay but does not implement a signer or durable storage. A future
repository must commit the claim, fencing and budget reservation atomically before
contact; recoverable signer results must preserve that same operation identity.
Artifacts/results require immutability, consistency checks and authoritative readback.

## Wallet qualification and P3-02

Android MWA 2.0 `solana:signTransactions` is optional/deprecated. Mandatory
`signAndSend` support does not satisfy this profile. Check the exact feature,
wallet version, OS and verified integration evidence; never fall back automatically.
[MWA specification](https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec.html#deprecated-features).

Qualification must establish sign-only behavior, exact message/blockhash/instruction
preservation, partial signatures, account and network selection, no hidden submission,
verifiable artifacts, correlated responses and interruption recovery. The typed
record is a trusted qualification attestation, not an untrusted wallet capability
advertisement. Every required guarantee must be explicitly true.

iOS remains **UNVERIFIED / CONDITIONALLY FEASIBLE**. No provider or adapter is
selected. MWA transport on iOS is rejected by this V1 qualification contract;
future universal-link/other adapter support requires independent evidence.
Web/mobile share economic meaning; OAuth, wallet handoff and secure storage stay
transport-specific and outside economic authorization fields.

## Privacy, ZERA and activation

Only an opaque nonce-salted digest is contemplated for a future public memo. The
full private envelope remains access controlled. Digest correlation is still public
and must be considered in retention/privacy review; hashing is not anonymization.
No memo is inserted in today's transfers.

No ZERA mint, allocation, supply, allowlist, routing or incentive enters this SDK.
A future separately qualified optional asset can use identity/amount/authority
contracts. Its program/profile, economics and activation remain separate gates.
ZP, ZTS and ZERA are not conflated. Ordinary payments remain independent of ZERA.

## Compatibility and migration

| Consumer | Classification | This package / later requirement |
|---|---|---|
| Existing Protocol execution, Mock rail, Devnet transport, receipts | unchanged | Existing exports and behavior retained |
| Backend current HTTP intent/execution/status APIs | unchanged | No field or response migration |
| Backend Devnet records | adapter required | New optional pure projection; not wired into routes/workers |
| Backend SDK dependency | adapter required | Audit-local reproducible 0.4.0 package; approved release pin later |
| Site intent/execution/receipt/activity projections | unchanged | No repository edits or client migration |
| Future Mainnet preparation/policy/finalization | future migration | Qualified evidence, durable fencing and separate implementation authorization |
| Future shared mobile contract and native transports | future migration | Language-neutral fixtures, native auth and wallet qualification |
| Historical Frontend | legacy/no new development | No new signing or multi-asset work |
| Creators/agents/providers | future migration | Optional references now; mandated permissions/fulfillment later |
| ZERA | unchanged | Separate optional-asset qualification and activation |

0.4.0 is an additive SDK release candidate, not a published/tagged release. All new
schema and digest domains are explicitly V1. Existing v0.3.1 contracts retain their
meaning. No database migration is introduced. Production deployment order remains
approved Protocol/SDK release, compatible Backend, then client consumers if needed.
Rollback keeps old APIs and outstanding committed artifact reconciliation available.

Before release: independent audit, qualified registry/evidence issuer design, actual
signer isolation and transactional fencing, provider/OS testing, fee/ATA evidence,
privacy/support operations and any specialist inputs. Architecture, implementation
and real-funds activation remain separate approvals. This candidate stops at audit.

## Local validation record

- Locked dependency installation and SDK build passed.
- `npm run test:contracts`: typed fixtures plus 71 focused tests passed.
- `npm run test:ci`: 116 tests passed, including all 45 existing bounded Runtime/
  execution tests. No Anchor/local-validator or live-chain suites were run.
- Package export/allowlist checks and `git diff --check` passed.
- Existing dependency-audit findings remain outside this package; no dependency
  versions were changed in Protocol. No SDK release/tag/push was performed.

Fixtures exercise deterministic hashes, material mutations, exact message shape,
signature slots, account substitution, cancellation, renewal and fail-closed wallet
capabilities. They prove offline contracts, not production signer or storage safety.

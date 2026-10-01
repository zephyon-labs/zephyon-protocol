# Mainnet P2P Fund Authority and Signer Architecture V1

Status: CANONICAL ARCHITECTURE via protected PR #4; no activation authorization.
Recorded: 2026-09-30. Owner: Protocol/Runtime architecture, with Backend and client consumers.
Production-signing implementation authorization: NOT GRANTED. Real-funds activation: NOT GRANTED.
The separately authorized Asset/Economic Intent V1 package is limited to additive offline contracts.

The audited direction was merged at `82862e2b28c15e05d95026b391df82092ce89805`.
The original architecture-only approval is not deployed functionality, provider
qualification, legal clearance or production-signing permission. It changes no executable contract, SDK version, custody setup,
secret, asset allowlist, payment route, or ZERA decision. The user requested this
architecture review after ZERA Optional Economic Participation Architecture V1.

## 1. Verified repository state

The [evidence record](../mainnet-p2p-authority-evidence-v1.md) pins all five clean
canonical repositories and source findings. Each local main matched remote main
via read-only `git ls-remote`. Hosted configuration, balances and secret custody
were not inspected. Source compatibility is not deployment attestation.

## 2. Current Devnet fund flow

The active path uses backend-controlled test inventory, not the connected user's
wallet balance. Its configured source is the canonical Circle Devnet USDC ATA of
the configured server signer. The operator must arrange pre-funding; repository
code does not establish the actual deposit/faucet provenance or current balance.
No user deposit, custody relationship or real-funds ownership is proved.

Backend configuration can inject 64-byte signer material; the concrete adapter
copies it into a server-process Keypair. An external signer implementation is also
injectable. Actual hosted storage is unverified. Runtime constructs a legacy
transaction containing one Classic SPL `transferChecked`, signs through that
boundary, and verifies the returned message. The server signer is both asset
transfer authority and SOL fee payer. Destination ATA creation is not bundled.

Backend encrypts and persists the signed artifact, commits submission ownership,
then calls Runtime transport to send its exact bytes once through the configured
Helius Devnet provider. Independent Devnet RPC reconciles the persisted signature.
Missing status remains UNKNOWN; only finalized success/failure becomes terminal.
Settlement projection checks persisted economics and finality in the same database
transaction as receipt creation. The receipt identifies `server-custodied-signer`.
It records a verified test-rail settlement; it does not prove customer-wallet
consent, beneficial ownership, fulfilled goods/services, or Mainnet readiness.

Phantom contributes connection, account-change notifications and read-only balance
context. It neither signs nor submits this payment. Auth0 identity, payment scope,
allowlisting and a confirmed request hash authorize use of bounded test inventory;
they do not authorize spending an independently controlled customer wallet.

## 3. Durable lifecycle preservation

Preserve immutable versioned intent, exact recipient snapshot, integer amount and
asset binding, idempotency, validated preparation, durable commitment before
possible effect, one application submission invocation, independent reconciliation,
evidence-bound terminal states and durable receipts. After possible submission,
recovery remains reconciliation-only. No timer or missing response creates retry
authority. Identical-byte network propagation is distinct from issuing a new
payment; V1 still permits only one application submission invocation.

Extend the lifecycle before wallet handoff. A server artifact currently already
contains all signatures; a future wallet request may contain none or only a subset.
Do not rename the current commitment and assume its proofs still apply.

## 4. Candidate authority models

A. **External user-controlled wallet:** the user retains transfer authority and
wallet recovery. ZephiPay receives public identities and signatures, never seeds.
Lowest new customer-key custody surface; onboarding and device/wallet support are
real costs. Exact-byte sign-only support must be qualified per wallet/version.

B. **Embedded user-controlled wallet:** preserve as a later alternative, especially
if mobile qualification shows unacceptable external-wallet friction. Require an
actual control map: all signing, export, recovery, reset, policy-change, additional
signer and provider-admin paths; whether user absence permits action; and an exit
path during application/provider outage. Familiar login is not proof of exclusive
user authority. For example, Privy's documented ownership configurations include
both sole-user ownership and configurations permitting additional parties to act;
its mobile export flow has separate browser-context dependencies. This is evidence
that configuration matters, not selection or qualification of Privy.
[Ownership configurations](https://docs.privy.io/controls/authorization-keys/owners/configuration/user/overview),
[mobile export](https://docs.privy.io/recipes/mobile-key-export).

C. **Platform/developer-controlled custody:** park outside the first consumer P2P
product. Both pooled and segregated models give the operator withdrawal/control
responsibilities; segregating accounts alone does not remove key authority.
Require a distinct ledger/liability model, qualified KMS/HSM or custody provider,
privileged approvals, segregation/reconciliation, recovery/withdrawal governance,
funded incident response, insurance/risk evaluation and specialist review. No
compelling requirement currently outweighs the operational burden and blast radius.

D. **Hybrid:** preserve an explicit authority-mode seam, not simultaneous launch
of multiple implementations. External default first; qualified embedded later;
custodial service only as a separately approved product. Mode-specific ownership,
recovery and evidence rules must not collapse into a generic `walletConnected` flag.

## 5. Qualitative decision matrix

| Criterion | External user-controlled | Embedded user-controlled candidate | Platform custody | Hybrid expansion |
|---|---|---|---|---|
| Authority clarity | Direct wallet transfer signer; separate app binding | Depends on owners, additional signers and recovery controls | Operator can move customer assets | Clear only with explicit per-account modes |
| Security / blast radius | App holds no customer keys; wallet compromise remains | Provider/app/auth dependency can span users | Central compromise can affect pooled or many segregated accounts | Union of each mode's risks |
| Custody/legal exposure | Relay, sponsorship and control still need review | Actual reset/export/admin reach must be reviewed | Most extensive custody/withdrawal obligations to assess | Multiple separately reviewed boundaries |
| UX | Wallet installation, selection and signing handoff | Potentially simpler onboarding | Simple surface with heavy hidden operations | More choices and disclosures |
| Recovery | User wallet recovery; separate ZephiPay account recovery | Provider/user recovery and export must be proven | Operator recovery and withdrawal support | Support must identify the correct recovery domain |
| Web | Qualified wallet discovery and sign-only method | Qualified browser SDK/configuration | Server signing | Shared economics, multiple adapters |
| iOS | Wallet-specific universal-link signing; qualification prerequisite | Possible future native path, provider not selected | Native client to custodial backend | No automatic MWA equivalence |
| Android | MWA where supported, otherwise qualified wallet links | Possible future native SDK path | Native client to custodial backend | Capability/version matrix grows |
| Support | Callback/connection and independent-wallet help | Account plus provider/key-recovery support | Disputes, withdrawals, custody incidents | Highest routing complexity |
| Implementation effort / capacity | Bounded two-signature relay plus durable handoff extension | Adds provider controls, recovery and exit qualification | Substantial operational organization beyond current scope | Stage gradually; no broad abstraction now |
| Provider lock-in / interoperability | Multiple qualified wallets; no forced migration | Export and independent exit may still depend on provider | Custody and ledger migration are consequential | Portability must be explicit |
| Durable execution | Strongest with sign-only plus withheld sponsor signature | Fits only if exact-byte signing and effects are documented | Matches server signing structurally but changes fund liability | Each effect boundary needs separate evidence |
| Creators / agents | Same recipient spine; agents need explicit future delegation | Can support future restricted signers after review | Operator mandates and liability differ | Never infer delegation from mode |
| Optional ZERA | Explicit asset identity permits later qualification | Same, subject to token/provider support | Same, with separate custody review | No mode activates ZERA |

## 6. PREFERRED MAINNET P2P FUND-AUTHORITY ARCHITECTURE

**Default: external user-controlled asset authority, backend-prepared exact
transactions, sign-only wallet handoff, a separately controlled fee sponsor that
co-signs last, and backend single-attempt relay.** Embedded user-controlled wallets
are an optional future mode; generic wallet/provider direct submission and platform
customer-fund custody are not the first release profile.

The user is the represented economic principal and controls the source SPL account
through their wallet. ZephiPay owns only its limited SOL sponsorship inventory.
Runtime defines acceptable economics and policy. Backend binds authentication,
intent, consent, Runtime evidence and durable execution. The wallet signs the
asset transfer. The fee authority signs only the same verified message after user
consent and fresh Runtime approval. Backend alone receives and persists the fully
signed artifact, then submits once. Neither signature substitutes for the other.

This choice buys a useful safety property: before sponsor finalization, even a
wallet that leaks/broadcasts its partial signature cannot execute that exact
message without the missing fee signature. Solana requires signatures over the
same immutable message, including the selected fee payer. This is a design
inference from the signing model, conditional on the release controls below.
[Solana partial signing](https://solana.com/docs/core/transactions/partial-signing).

It does not require transferring customer assets into a platform treasury. It
adds bounded operational fee-key risk and sponsorship cost; those must be funded
and qualified before implementation/activation. If this gate cannot be qualified,
reopen the decision rather than silently fall back to customer custody or direct
submission. No signer provider, wallet vendor or monetary budget is selected.

## 7. User authorization contract

A login/session authorizes access to application capabilities. Wallet binding
proves control for a stated purpose. Economic consent authorizes one exact action.
These are separate records. Persist this minimum review envelope:

| Field group | Required binding |
|---|---|
| Identity | Represented principal; authenticated operator; active role if relevant; account/security versions |
| Source | Wallet binding ID/version, authority mode, source owner public key, token account, permitted delegation if any |
| Recipient | Recipient identity snapshot/version, beneficiary, verified destination ID/version, exact wallet and token account |
| Asset/network | Chain family, exact network/genesis domain, token program, approved mint, verified decimals |
| Value | Positive integer atomic units; invoice denomination separately if applicable; no float conversion |
| Fees | Fee payer, sponsorship mode, base/priority fee bounds, ATA funding and any separately approved user charge |
| Context | Purpose and request/order/service reference; immutable intent ID/version/digest |
| Validity | Consent/intent expiry, preparation generation, wallet handoff ID, nonce and message digest |
| Policy | Authentic Runtime decision ID/version, evidence scope/digest, validity and limitations |
| Consent evidence | Authenticated confirmation of the envelope, expected signer and verified transaction signature |

A transaction signature by itself does not cryptographically cover an off-chain
account ID, purpose or policy record. Preferred binding: canonicalize the economic
envelope (including a high-entropy unique nonce), domain-separate and hash it, then
include only that opaque digest in one approved memo instruction. Construct the
message afterward and bind its digest to the envelope. This avoids a hash cycle.
The user's transaction signature then covers the digest as well as the transfer.
Serialization, digest domain, memo program and privacy review are implementation
gates, not an executable wire format here. A memo is neither chain idempotency nor
proof that the human understood the display. Never put personal data on-chain.

## 8. Transaction construction

Backend orchestrates a Protocol-owned pure preparation/validation contract with
trusted asset evidence, recipient snapshot and Runtime decision. Infrastructure
adapters supply blockhash/account data and later signing. Clients display the
review envelope and transport the frozen transaction; they do not choose economic
instructions, mints, destinations or priority fees.

Reject arbitrary client/provider-built transactions in the first profile. A later
provider-built mode needs a complete semantic decoder and evidence for every
allowed instruction; matching a displayed amount is insufficient. Do not reuse
the current Devnet preparer unchanged: it signs during prepare and requires one
signer/instruction. Mainnet requires a separately versioned unsigned/partial/full
artifact lifecycle, with no change to the existing controlled-beta path.

## 9. Transaction verification

Before accepting a returned wallet result, the authoritative verifier must:

1. Decode the allowed transaction format and compare exact serialized message
   bytes/digest with the persisted preparation. No wallet-added fee or memo changes.
2. Verify every supplied Ed25519 signature against its expected required-signer
   slot; require the bound user authority and, before relay, the fee authority.
3. Check source account token-program owner, mint, transfer owner/allowed authority,
   frozen/delegate/close-authority state under explicit policy, and sufficient funds.
4. Check exact beneficiary/destination, derived ATA, mint, integer amount, decimals,
   signer/writable account flags, instruction order and the complete program list.
5. Bind recent blockhash, recorded last-valid height, provider/genesis identity,
   fee payer, fee bounds, opaque authorization digest and preparation generation.
6. Permit only the transfer and explicitly approved auxiliary instructions in
   section 18; reject delegate approvals, authority changes, account closure,
   swaps, extra transfers, unknown programs and arbitrary fee deductions.
7. Recheck applicable consent and policy validity at finalization and before relay.
   Revalidation must confirm the bound decision remains valid; a changed material
   policy/version or economic envelope requires a new review and signatures.
   Never update the memo-bound decision reference under an existing signature.

First profile: one Classic SPL transfer, ordinary recent blockhash, legacy message;
no address lookup tables, durable nonces, multisig transfer owners, Token-2022
extensions or generic program calls without a separate profile decision. The
contract's asset identity is extensible; its initial allowlist is deliberately
narrow. Source state can race after inspection; chain execution remains authoritative.
Simulation is diagnostic, not settlement or sufficient authorization.

Settlement reconciliation verifies the exact transaction/signature, message,
network and execution metadata from qualified independent infrastructure against
the committed artifact. RPC acceptance or a callback cannot substitute for that
match. Current signature-status-only observation must not silently be generalized
to unbound externally supplied signatures.

## 10. Signing boundary

Asset keys remain inside the user's chosen qualified wallet. ZephiPay never asks
for a seed, private key export, shared recovery secret or general token delegation.
It receives the user signature or partially signed transaction over the frozen
message. A user signature authorizes only that message, not future spending.
In this sponsored profile the fee payer supplies the first signature used as the
chain transaction ID. The returned asset-owner signature alone is not that ID.
Persist ordered signer identities, each verified signature and the final transaction
ID separately; never put the partial user signature into a status lookup as though
it identified a complete transaction.
[Solana transaction structure](https://solana.com/docs/core/transactions/transaction-structure).

The sponsor signer is a separate operational control boundary for platform SOL;
it is never source-token owner/delegate/close authority. It must verify authentic
policy/consent bindings and a one-use finalization authorization, enforce exposure
limits, and return only the fee signature to backend persistence. It must not
broadcast, expose a generic signing endpoint or allow recovery/export/admin paths
to bypass these requirements. Exact service, isolation, key storage, rotation and
operator access remain security-qualification decisions. A KMS label alone does
not prove policy enforcement.

For embedded candidates, provider-side recovery, additional signers, session
permissions or administrative resets might permit action without a new prompt.
Those paths require explicit qualification; P2P V1 grants no standing spend mandate.

## 11. Submission architecture

| Mode | Lifecycle requirement | V1 disposition |
|---|---|---|
| Wallet signs, Backend relays | Withhold fee signature during wallet handoff; validate user result; persist full artifact and signature; commit once before RPC | Preferred default |
| Wallet signs and directly submits | Durable commitment before handing out a complete spending capability; exact-message discovery if callback/signature lost | Parked pending separate proof; no automatic fallback |
| Embedded provider submits | Durable provider operation/idempotency record before call, independently queryable outcome, exact-message mapping and no hidden rebuild/retry | Parked submission mode; provider signing-only may later fit default |

The submission provider may propagate the identical transaction. It must not
construct replacement bytes, change blockhash or charge/send a different payment.
Application retry ownership stays in the durable contract, never SDK defaults.
A network send acknowledgement proves acceptance for processing, not settlement.

## 12. External side-effect boundary

Treat any handoff that can expose a complete executable transaction as possible
submission before the handoff call. Callback absence never means safe to send
again. A browser abort, app kill or wallet error cannot prove no external effect.

For the preferred partial-signature flow, wallet handoff is still durably recorded,
but it does not expose a complete capability while the sponsor signature is withheld.
This narrower fact must be proved from message shape and sponsor-release state,
not inferred from a method name such as `signTransaction`. If a wallet/provider
can access the fee signature or mutate the approved message, this profile fails.

## 13. Pre-handoff commitment and state model

Persist before opening a wallet: intent/principal/role versions, source binding,
recipient snapshot, full economic envelope and digest, exact unsigned message and
digest, required signers/fee payer, asset/network, amount, fees/ATA terms, policy
evidence, consent context, expiry/last-valid height, handoff nonce/ID, transport
capability/version, preparation generation, single-use claim, and recovery identity.
Store secret transport/session material only in appropriately protected storage;
never include it in ordinary logs or public receipt fields.

Conceptual states below are requirements for later contracts, not current enums:

| State | Durable fact and allowed next work |
|---|---|
| REVIEW_READY | Versioned intent and review envelope; no external handoff |
| WALLET_HANDOFF_COMMITTED | Frozen message and handoff committed before opening wallet; sponsor signature not issued |
| WALLET_RESULT_UNKNOWN | Lost callback; no inference about user signature; inspect authoritative finalization state |
| USER_SIGNATURE_VERIFIED | Signature over exact message persisted; still no complete spending capability |
| FINALIZATION_COMMITTED | One generation atomically wins sponsor-signing authorization; cancellation/replacement fenced before contacting signer |
| SIGNED_ARTIFACT_PERSISTED | Complete verified bytes, first transaction signature, digests and signer evidence durably stored |
| SUBMISSION_COMMITTED_RECONCILE_ONLY | Single live owner may initiate first RPC; crashes never reacquire submission permission |
| ACCEPTED_PENDING / UNKNOWN | Only independent reconciliation; no replacement or new automatic authorization |
| SETTLED / FAILED_ONCHAIN | Exact finalized successful/failed transaction evidence; durable receipt or failure record |
| CANCELLED_BEFORE_FINALIZATION | Durable tombstone prevents any sponsor signing for old generation; new review may be explicitly requested |

Wallet outcome, signature completeness, sponsor-signing certainty and submission
contact certainty are distinct dimensions. A single `pending` flag is inadequate.
Only verified facts may reduce uncertainty; leases expiring do not.

The finalization transition, generation cancellation and budget reservation must
serialize against each other. Commit FINALIZATION_COMMITTED before calling the
signer. A stale worker or late callback cannot mint a fresh signer authorization.
Once that transition wins, do not issue a competing generation because of timeout.
An uncertain signer result is queried/recovered idempotently for the same message;
it never authorizes rebuilding. A fee signature must never be released to the
client, wallet or submitting provider before the full artifact and submission
commitment are durable. If the signing service cannot prove this ordering, stop.

## 14. Lost-callback recovery

| Situation | Required authoritative behavior |
|---|---|
| App/wallet killed before callback, sponsor finalization never committed | Show authorization outcome pending; atomically tombstone the old generation before permitting a new explicit review/signing attempt. Late user signatures for the old message cannot receive sponsorship. |
| Callback upload response lost | Read durable intent/attempt state. Re-uploading the same result may be idempotent; it must not start another handoff, finalization or submission. |
| Signing-service response lost after FINALIZATION_COMMITTED | Freeze replacement; retrieve the same operation/result using its durable identity. If it cannot be established, retain UNKNOWN and investigate. |
| Fully signed artifact exists; uncertainty about relay | Use stored first signature and independent reconciliation. No automatic resubmit/rebuild, even if caller believes RPC was never contacted. |
| Direct wallet/provider handoff may have submitted; signature known | Verify its binding to exact message, then reconcile that signature. |
| Direct wallet/provider handoff may have submitted; no signature | UNKNOWN without a transaction ID. Obtain provider operation evidence or scan qualified complete address/block history for the exact message/opaque reference. No discovery result is proof of absence. |
| Duplicate or spoofed callback | Authenticate transport where supported, correlate nonce/intent/generation, verify actual signature and exact bytes; return existing state or reject. Never trust claimed success. |

A complete finalized exact-message match can establish success or chain failure.
A finalized failure can still cost fees; a new payment then requires a fresh
explicit request/authorization, linked to the prior attempt. A new obligation must
not silently duplicate an unresolved one. Pending budget/obligation exposure stays
reserved until terminal evidence or a qualified pre-finalization cancellation.

A no-signature direct-submission case has no general reliable negative-proof API.
Expiry plus a null history query is insufficient. Exhaustive finalized-window
coverage and a uniquely bound message might support a future non-inclusion rule,
but no such rule is approved here. Without it, UNKNOWN can persist and support
cannot clear it by timeout or by creating a new intent ID. This is a principal
reason direct submission is excluded from the preferred first profile.

## 15. Wallet account switching

Snapshot selected provider/session, chain, public key, source account and binding
version. Listen for account/network/disconnect changes to stop the local flow,
but server-side comparison is authoritative. A mismatched returned signer or
changed source invalidates the attempted authorization; never rewrite the payer
from the callback. Before finalization, atomically cancel the old generation and
require fresh policy/review/signature. After possible effect, retain and reconcile
the old attempt; switching accounts cannot erase it or permit replacement.

## 16. Intent expiry and blockhash validity

Intent/consent expiry is a business deadline; recent-blockhash validity is a chain
lifetime. Check both before handoff, sponsor signing and first relay. No hard-coded
wall-clock estimate replaces last-valid block height and qualified network state.
Never modify a blockhash, fee payer or instruction under old signatures.

Before finalization, fence/cancel the prior generation, obtain a fresh preparation
and explicit consent. After possible effect, expiry does not prove prior absence
and never permits blind regeneration. The preferred profile intentionally retains
the conservative current no-resubmission rule.

A fully signed ordinary SPL transaction has no custom intent-expiry or policy-
revocation instruction. Once complete bytes could escape, later application
revocation cannot prevent inclusion while the chain lifetime remains valid.
Disclose that boundary; stop new signing/submission but continue reconciliation.
A strict on-chain wall-clock deadline or immediate revocation requirement would
require a separately reviewed enforcement mechanism and reopening this decision.
[Solana confirmation and expiration](https://solana.com/developers/cookbook/transactions/confirmation).

## 17. Fee payer and sponsorship

Preferred initial profile: ZephiPay sponsors bounded SOL base/priority fees and,
when approved, recipient ATA funding. The fee payer is fixed before user signing
and is distinct from the asset owner. No sponsor key controls user token inventory.
This also lets a user holding only approved USDC pay without first acquiring SOL.
Fees are real costs, not token rewards or an unlimited product promise.
[Solana fees](https://solana.com/docs/core/fees).

Require prefunded operational exposure limits, per-principal/attempt concurrency
accounting, abuse controls, fee quotation, incident stops and a viable funded
business policy. Fee, rent and possible charges must be shown before confirmation.
No funding amount, fee rate or customer charge is chosen here. If sponsorship is
unavailable, fail clearly; do not silently switch the fee payer or debit extra USDC.
User-paid SOL and provider sponsorship remain separate future profiles requiring
new consent, different uncertainty analysis and independent approval.

## 18. ATA and auxiliary instructions

Initial profile may include exactly one approved idempotent destination ATA-create
instruction when needed, a bounded compute-budget instruction set, the opaque
binding memo, and one exact `transferChecked`, in a fixed reviewed order. ATA must
be derived from the verified destination owner, approved mint and token program.
Account data must match when the ATA already exists. Sponsor-funded ATA creation
does not make the sponsor owner or entitle it to reclaim the rent reserve.
[Solana token accounts](https://solana.com/docs/tokens/basics/create-token-account).

The verifier must reject extra programs/accounts, duplicate or conflicting compute
limits, oversized priorities, delegate approvals, authority changes, close-account
instructions and arbitrary SOL transfers. All material costs need consent and
policy approval. If ATA setup is separated, use a distinct idempotent sponsored
setup intent/evidence; it is not payment settlement and must not authorize the
customer transfer. Prefer bundling for the initial narrowly qualified profile.

## 19. Recipient ownership

An address passing syntax checks is not proof of control or identity. Before
Mainnet username routing, require an authenticated canonical recipient account,
active/payable state, and a verified receiving-destination binding. For the initial
ordinary wallet profile, use a server-issued single-use, domain/network/account/
purpose/expiry-bound challenge signed by that wallet and independently verified.
This proves key control at that time, not legal identity or permanent sole control.
Reject unsupported exchange deposit/PDA/multisig destinations until their distinct
proof model is approved. Direct unverified address-send is not silently inherited
from the Devnet tester UI.

New binding/change requires recent authentication and appropriate independent
step-up, ownership proof, versioning, notifications to established channels and
risk-triggered delay/cooling. Exact triggers, delays and factors require security
review; no arbitrary monetary thresholds are invented. Recovery cannot skip proof.
Resolve recipient state freshly for preparation/finalization. An altered destination
must invalidate unexecuted approval and require review; it cannot redirect an
already authorized attempt. Committed attempts keep their original snapshot.

## 20. Runtime policy versus user authority

Execution requires both valid user economic consent and authentic applicable
Runtime approval. The fee-signing boundary consumes that evidence before completing
the transaction; a frontend flag or backend-invented approval cannot stand in for
it. Runtime never receives authority to spend for the user merely by approving.
The backend owns persistence and orchestration, not duplicate economic policy.

Scope this claim honestly: Runtime gates ZephiPay's accepted payment path and
sponsor capability. A user-controlled wallet can independently send outside
ZephiPay; an off-chain Runtime cannot prohibit all transfers of freely controlled
assets. Such transfers are not automatically approved ZephiPay intents or receipts.
A global policy lock would require another authority model or on-chain mechanism,
which is not selected. A compromised Runtime/policy signing authority remains a
security risk; logical layering alone does not make it independently trustworthy.

## 21. Fail-closed production policy contract

Before a payment is executable require authenticated principal/account state,
source-control binding, verified recipient destination, exact asset/network and
integer amount, fresh applicable limits, risk evidence, compliance evidence where
applicable, policy/version binding, fresh consent, account/device risk state,
fee exposure and correct execution generation. Each evidence record needs issuer,
subject, scope, result, validity, version and a verifiable reference/digest.

Missing, stale, contradictory, pending or unavailable required evidence means
not executable. A justified not-applicable assessment differs from a missing
check. Default approvals and test attestations cannot qualify real-funds execution.
The source contains smoke-path approving services and a bounded browser Devnet
eligibility path; neither is demonstrated Mainnet identity/compliance/risk coverage.
Production providers and thresholds remain separate implementation gates.

## 22. Session and step-up

Keep read, account mutation and payment-operation scopes separate. Require recent
authentication plus risk-appropriate step-up for wallet binding, receiving-address
change, new device, account/key recovery, custody-sensitive changes and policy-
defined significant payments. Session possession, cached wallet authorization,
local biometrics and account ownership are not transaction-specific user consent.
Use server-verified freshness and evidence; client timestamps are untrusted.
Do not select step-up factors or financial thresholds before the threat/risk review.

## 23. Active web architecture

Use `zephipay-site` as the active product path based on its authenticated backend
contracts and durable Devnet workflow. Proposed sequence: login; choose qualified
wallet; prove source binding; resolve verified recipient; create immutable intent;
Runtime evaluation; show amount, source, destination and fees; explicit confirmation;
commit wallet handoff; obtain user-only signature; verify/persist; revalidate policy;
commit sponsor finalization; co-sign and persist; commit relay; submit once;
independently reconcile; expose durable receipt. Reload reads backend state.

Use capability-based wallet discovery with explicit user selection and no arbitrary
provider default. Signing transport must support exact messages with a distinct
fee payer. Browser connection UI is not reused as economic authorization. Retain
session/CSRF/origin protections; never put signed artifacts or bearer credentials
in query strings or analytics. Client checks improve UX but do not grant authority.

## 24. iOS architecture

Do not assume MWA parity. Official Solana Mobile guidance says MWA is unavailable
on iOS and describes suspension/selection/return limitations. Phantom separately
documents iOS universal-link requests and a sign-only transaction method. These
support a candidate single-operation integration, not proof of reliable app lifecycle
or broad wallet interoperability. Treat both pieces of evidence explicitly.
[MWA on iOS](https://docs.solanamobile.com/recipes/mobile-wallet-adapter/wallet-signing-on-ios),
[Phantom links](https://docs.phantom.com/phantom-deeplinks/deeplinks-ios-and-android),
[Phantom sign-only](https://docs.phantom.com/phantom-deeplinks/provider-methods/signtransaction).

Preferred candidate: named qualified external-wallet universal-link signing adapter,
explicit wallet selection, protected encryption/session state and durable backend
handoff identity. The app restores state after process death; a return URL/push only
triggers an authenticated read. Verify callback correlation and transaction signatures.
A missing wallet, unsupported partial-sign format, or lost transport state never
falls back to sign-and-send. Qualification must exercise real supported iOS/wallet
versions without value-bearing transactions before selecting a vendor/launch scope.
If no external adapter meets the gate, iOS signing remains blocked pending a qualified
embedded user-controlled alternative; do not change the authority model silently.

Native login uses authorization code with PKCE through an external system browser,
exact registered redirects and state/nonce checks; keep refresh/session and wallet
transport material in appropriately protected Keychain storage. No app-embedded
OAuth client secret or customer asset key is introduced by this design.
[RFC 8252](https://www.rfc-editor.org/rfc/rfc8252),
[OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700).

## 25. Android architecture

P3-02 contract clarification: MWA 2.0 sign-only `solana:signTransactions` is
optional/deprecated. Explicit wallet/version capability qualification is required;
`signAndSend` support is insufficient and cannot be an automatic fallback.
[MWA specification](https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec.html#deprecated-features).

Prefer a qualified MWA sign-only capability where supported; explicitly select
network/account and inspect wallet capabilities/transaction versions. The reference
documents both sign-only and sign-and-send operations; they must not be treated as
equivalent. A wallet that exposes only sign-and-send does not meet the initial
profile. Wallet-specific verified app links are a separately qualified alternative.
[MWA signing API](https://docs.solanamobile.com/get-started/react-native/mobile-wallet-adapter).

Use the same durable handoff/partial-signature/finalization flow as web/iOS. Resume
from backend truth after activity recreation, process death, wallet switching or
network loss. Native OAuth uses external browser and PKCE; platform Keystore-backed
storage protects tokens and transport secrets. Cached connection authorization is
not a spend mandate; app return or push is never settlement evidence.

## 26. Shared client contract

Share versioned integer amount and asset identity, review envelope, intent and
recipient snapshot, policy/consent summaries, handoff generation, execution status,
receipt, recovery transitions and error classifications. Native clients need a
language-neutral contract and fixtures; a TypeScript SDK alone is not the contract.
Clients consume authoritative transitions and never independently approve policy.

Keep OAuth redirects, wallet transport, secure storage, biometric prompts, push
handling and lifecycle restoration platform-specific. Pure formatting/schema logic
may be reused without moving authority out of Runtime/Backend. Proposed bounded
error families: action-required, pre-handoff-rejected, stale-consent, unsupported-
capability, authorization-unknown, submission-unknown and terminal-chain-failure.
No unknown outcome is advertised as safely retryable.

## 27. Creator compatibility

A creator is a recipient/role with the same verified destination, intent, consent,
execution and receipt spine. Bind order/service and beneficial recipient separately
from wallet address. Settlement does not prove delivery, licensing, refunds or
service fulfillment. Creator onboarding and any split payments are future scoped
work; the initial one-transfer profile grants no revenue-splitting authority.

## 28. Agent compatibility

Preserve represented principal, agent/operator identity, mandate/version, permitted
assets/recipients, per-action and aggregate budgets, expiry/revocation and signer
mode. Reserve concurrent liabilities until conclusive resolution; account aliases
cannot reset a principal's budget. Future delegated signing must be separately
approved, revocable within its real technical limits and bounded by mandate plus
Runtime policy. Agent identity, wallet possession and a fee sponsor do not create
spending authority. No agent executor or delegation is implemented here.

## 29. ZERA compatibility

Bind an approved asset by network/genesis, program, mint and precision, never by a
hard-coded semantic assumption that every amount is USDC. Initial production asset
qualification may still be USDC-only. This creates no ZERA allowlist entry, mint,
route, reward, custody decision or activation. ZERA main at
`237d9b774bb374fcfd389637ce3ab46fdbb81697` remains unchanged. Its optionality and
ZP/ZTS/ZERA firewalls remain controlling. A later asset can reuse the authority
contract only after its own economic, token, legal, security and activation gates.

## 30. Qualified legal/compliance review inputs

This ADR reaches no legal classification. Give qualified specialists the actual
control map, jurisdictions/users, money flow, fee arrangements, counterparties,
recovery powers and operating contracts, not a marketing label.

- External/relay profile: transaction relay, fee co-signing/control, geography,
  KYC/KYB applicability, AML/sanctions responsibilities, privacy and consumer terms.
- Embedded candidate: every owner/signer/admin/recovery/export permission, provider
  contracts/subprocessors, independent exit and who can act without the user.
- Platform custody: pooled/segregated beneficial ownership, custody/withdrawal and
  licensing analysis, safeguarding, ledger reconciliation, insolvency, complaints,
  insurance and incident responsibilities.
- Hybrid: mode-specific disclosures, eligibility and migration; changing modes
  cannot silently alter control or regulatory assumptions.

Review is a gate before real-funds implementation decisions dependent on its
answer; architecture work can record requirements without inventing clearance.

## 31. Security threat model

Labels describe intended controls, not tested guarantees. Residuals require an
owner and explicit acceptance before activation.

| Threat | Preferred external + relay profile | Embedded / custodial difference | Treatment and residual |
|---|---|---|---|
| Browser compromise / malicious client | Exact message checks and independent wallet confirmation; no customer key in site | Embedded key/auth surfaces may share compromised app context; custody sessions may trigger withdrawal | Prevent unauthorized mutation at trusted verifier; contain key reach; deceptive consent remains residual |
| Backend compromise | No user key; sponsor must independently validate scoped finalization evidence | Extra embedded server signers or custodial keys can expand loss across users | Contain asset-key reach, detect audit divergence; compromise of policy/consent roots together remains material |
| Mobile compromise | Protected transport state and external wallet boundary | Embedded wallet often shares device/application trust | Contain, detect suspicious bindings; fully compromised device can deceive user |
| Provider compromise | Submission cannot alter frozen signatures; independent chain observation | Embedded reset/export powers or custody service may expose many wallets | Contain/compare providers; Byzantine correlated infrastructure is residual |
| Wallet/key compromise | Attacker may independently spend user's funds | Embedded recovery controls or custodian key estate changes blast radius | Prevent where wallet supports it; detect through user reports/monitoring; cannot reverse finalized theft |
| Session theft | No asset signature; step-up for binding/destination changes | Auth-linked recovery or additional signers can turn session theft into signing authority | Prevent session-only spend; contain with revocation; phishing remains residual |
| Destination takeover | Ownership challenge, step-up, versioned snapshots, notifications and risk delay | Same requirement in every model | Prevent silent redirects; detect and recover account binding; key control is not identity proof |
| Replay / duplicate callbacks | One-use nonce/generation; immutable message; one finalization and relay claim | Provider idempotency scope and retries must be qualified | Prevent duplicate platform execution; deliberate independent transfers cannot be globally prevented |
| Signing deception | Wallet-readable economics plus app review and exact digest binding | Embedded confirmation isolation must be assessed; custody UX can obscure authority | Detect inconsistency; residual human deception accepted only after UX/security review |
| Lost device / recovery attack | Account recovery separate from wallet recovery | Embedded/provider/custodian may possess recovery override powers | Recover account carefully, prove new binding; loss of independent wallet keys may be unrecoverable |
| Callback spoofing | Correlation, encryption/session checks, actual signature verification | Provider webhook signatures plus operation lookup required | Prevent callback-based false settlement; callback availability is not guaranteed |
| Duplicate submission after crash | Persist effect barrier and immutable signature; reconciliation-only recovery | Provider auto-rebuild is incompatible without a separately proved profile | Prevent application retry; UNKNOWN can sacrifice liveness for safety |
| RPC/provider failure | Keep pending/UNKNOWN; independent history/finality checks; bounded alerts | Provider dependency may prevent signing/export as well | Recover by evidence, never by time alone |
| Sponsor drain / fee abuse | Separate limited SOL inventory, exact shape, rate/budget limits, key isolation | Sponsorship provider adds another authority/service dependency | Contain financial exposure; budgets/key system still require qualification |

No cryptographic guarantee is claimed against simultaneous compromise of all
signing/policy/evidence roots. No support operator may resolve uncertainty by
mutating a receipt or overriding the no-duplicate boundary.

## 32. Recovery architecture

ZephiPay account recovery restores authenticated access after verified recovery
policy. It does not recover or acquire an external wallet key. Wallet recovery
restores that wallet's authority; it does not automatically replace a ZephiPay
recipient destination or identity. New/recovered bindings require proof, step-up,
versioning and risk treatment. Pending obligations remain visible across recovery.

If account access is restored but a wallet is lost, display and reconcile existing
payments; do not promise funds recovery. If a fee signer/provider is unavailable,
stop new finalization and preserve reconciliation/read access. Any key rotation or
service replacement must preserve evidence for all outstanding generations.

## 33. Support and dispute evidence

Support needs permissioned access to: immutable intended economics and recipient
snapshot; principal/role/source binding; user consent and exact signer/message;
Runtime decision/evidence references; handoff/finalization/submission commitments;
provider identities, observations and finality; unresolved reason; receipt and
integrity digests. Separate initiation, submission acceptance, finalized transfer
and commercial fulfillment. Display full details only to authorized participants.

Encrypt sensitive artifacts, minimize personal information, restrict operator
access and define retention/deletion/legal-hold policy before production. Logs
must not carry seeds, session tokens, signed transaction payloads or personal memo
contents. A finalized transfer is not promised reversible; any refund is a new
separately authorized payment and must not hide the original record.

## 34. Product-path convergence

`zephipay-site` is the active web development path: authenticated account/intent
proxies, durable status/recovery and explicitly controlled Devnet execution.
`zephipay-backend` owns authoritative persistence and orchestration; Protocol owns
SDK/economic contracts. Future native clients consume the same backend and contract.

`zephipay-frontend` is a legacy prototype: local simulated balances/receipts and a
route proxy to backend `/api/send`, which current backend documentation disables.
Do not add production signing there or infer readiness from wallet-adapter presence.
Historical Protocol treasury/Anchor documentation is a distinct path, not proof
that current P2P uses `splPay` or that customer funds should enter a treasury.
No repository deletion, UI migration or broad rewrite is part of this package.

## 35. Decision record and authority

This document records the canonical architecture direction for the reviewed repository state.
Selected preferred direction: external user authority plus sponsor-last relay.
Preserved alternative: separately qualified embedded user authority. Parked:
platform customer custody, direct submission, user-paid-fee profile and broad
hybrid launch. Rejected for this profile: session-only spend authority, silently
reusing the Devnet customer-funds model, callback-based success/failure, blind
replacement, and a signature treated as Runtime approval.

Independent review and protected PR #4 ratified this architecture direction.
Specialist-dependent decisions stay explicitly open.
No merge or review verdict would itself authorize real-funds implementation or
activation. This task stops at architecture/specification work.

## 36. Machine-readable contract disposition

Do not create another runtime configuration or executable authorization framework
in this package. Sections 7, 9, 13 and 21 define the bounded contract field groups,
state dimensions and fail-closed semantics that the next versioned schema must
encode. Serializations, consent/memo digest details, typed transitions, evidence
schemas and language-neutral fixtures belong to Asset Identity and Economic
Intent Compatibility V1 after review. This avoids a second source of truth before
Protocol and Backend consumers agree on the public contract.

## 37. Integration impact map

| Consumer | Required later work | Compatibility / migration boundary |
|---|---|---|
| Protocol/Runtime SDK | Explicit source/fee authorities, unsigned/partial/full preparation, policy evidence and exact multi-signature/auxiliary validation | Versioned additive contracts; no mutation of v0.3.1 Devnet behavior |
| Backend | Source/recipient proofs, consent, handoff/finalization ledger, signer capability, relay/UNKNOWN recovery, budget reservations | Additive durable schema/API migration; existing committed Devnet artifacts stay readable/reconcilable |
| Active site | Wallet qualification/selection, honest funding identity, review envelope and handoff recovery | Feature-gated new mode; preserve controlled-beta and simulation |
| Shared client contract | Language-neutral schemas, errors/state projections and conformance fixtures | No client-owned economic policy or embedded secrets |
| iOS | Qualified sign-only universal-link adapter or later qualified embedded alternative, Keychain and native auth | Gate each OS/wallet version; no assumed MWA parity |
| Android | Qualified MWA sign-only adapter/capability detection, Keystore and native auth | Direct-submit-only wallets unsupported initially |
| Authentication | Fresh-auth/step-up, account/source/destination binding versions, recovery controls | Preserve independent account/payment scopes; no login-to-spend equivalence |
| Wallet/sponsor integration | Exact-byte partial signatures, separate fee signer, durable operation identity, no hidden broadcast | Provider/security qualification before implementation |
| Monitoring/support | Unknown-age/commitment/fee exposure alerts, independent RPC health, evidence access and recovery runbooks | Submission stop must retain reconciliation; no timer-driven retry |
| Legacy frontend / ZERA | No implementation in this package | No migration or asset activation implied |

Deployment order for a later authorized package: Protocol contract/release, Backend
compatible migration and validation, then active web and native consumers. Define
minimum versions, downgrade behavior and rollback support before changes. Never
assume simultaneous deployment. Do not remove old reconciliation until every old
committed artifact is terminal or covered by retained compatible handlers.

## 38. Migration from current Devnet

Retain server-funded/server-signed Devnet as a separately labeled controlled test
mode. Preserve simulation. Bind execution mode, asset/network, signer role and
receipt provenance immutably; never toggle an existing intent into Mainnet.

Stage later work: adopt versioned contracts; prove state transitions and crash
boundaries offline; qualify wallet/provider transports without valuable assets;
run explicitly authorized isolated Devnet rehearsals; complete security/legal/
operational review; only then seek separate real-funds activation. A site flag,
changed RPC URL or recycled Devnet private key is not a migration plan. New customer
fund authority and fee keys require their own qualified setup, never test-key reuse.

## 39. Implementation and activation gates

Architecture gate: approve this direction, the custody/relay scope, sponsor-last
tradeoff, uncertainty rules and ownership boundaries after independent review.

Implementation gate: explicit scoped authorization; versioned interface agreement;
qualified recipient/source proof and step-up design; applicable specialist inputs;
wallet partial-signature capability evidence; sponsor signing/fencing/key threat
model; cost/abuse budget; policy provider/evidence model; privacy requirements;
and offline acceptance criteria. A generic provider SDK is not qualification.

Real-funds activation gate: completed audited implementation; all material findings
resolved; production identities/configuration/keys and access controls qualified;
required legal/compliance clearance; final asset/network/fee allowlists and limits;
mobile/browser matrix and crash/recovery evidence; independent reconciliation and
retention coverage; monitored operating procedures, support/disclosures and incident
stop/rollback plan; explicit release authorization. No real funds are authorized here.

Bounded future acceptance cases must include process death at every handoff,
finalization and submission boundary; duplicate callbacks/concurrent workers;
account switch; stale policy/consent; signer and destination substitution; missing
signature; signer response loss; provider mutation/retry; expiry and missing history;
ATA/fee injection; account-recovery takeover; receipt mismatch and old-mode recovery.

## 40. Asset Identity package readiness

**GO WITH PREREQUISITES** for a bounded architecture/schema package, not automatic
permission to implement or activate it. The direction is ratified by PR #4;
consumer contracts must agree that source authority, fee authority, partial-signature completeness and
possible-effect certainty are distinct contract fields. Pin the consumer/version
migration plan and define exact envelope/message binding plus offline conformance
cases. No wallet vendor or Mainnet custody account must be created to design that
contract. Provider qualification, actual sponsor signing and real-funds activation
remain later gates, not work silently pulled into asset-schema design.

P3-01 contract follow-up: [Asset/Economic Intent V1](../asset-economic-intent-v1.md)
defines server-generated finalization identity, immutable tuple, uniqueness,
replay/conflict and recovery semantics. Operational signer qualification remains open.

## 41. Open decisions and reopening triggers

| Open decision | Required resolution / trigger |
|---|---|
| Sponsorship funding and cost limits | Named budget owner and viable bounded economics; do not launch if unfunded |
| Fee signer implementation and isolation | Prove policy/consent validation, fencing, idempotent recovery, no broadcast/export bypass; otherwise reopen preferred profile |
| Qualified wallet/OS matrix | Exact sponsored partial-message support and interruption tests; failed iOS qualification triggers embedded-alternative study or narrower launch |
| Source/destination proof and step-up | Challenge format, risk factors, recovery/delay rules, notifications and ownership evidence |
| Runtime production evidence | Qualified identity/compliance/risk sources, freshness and authentic decision binding |
| Business expiry versus chain validity | Disclosures and validity policy; hard chain-enforced expiry demands a separately reviewed mechanism |
| Envelope and wire format | Canonical serialization, opaque memo binding, API/schema versions, privacy review and conformance fixtures |
| Mainnet asset/transaction allowlist | Qualified USDC evidence and exact auxiliary programs; no ZERA route implied |
| Embedded provider/exit model | Full reset/export/additional signer/admin controls, availability and independent exit rehearsal; no vendor selected |
| Direct-submission negative evidence | Complete recoverability if signature missing; remains parked without proof |
| Legal/geographic product scope | Specialist conclusions on actual custody/control, relay, sponsorship and duties |
| Retention, support and finality assurance | Access policy, independent infrastructure, evidence completeness, response ownership and service objectives |
| Mainnet release | Separate explicit implementation and real-funds activation decisions |

## 42. Recommended next step

Independently review the follow-up implementation, focusing first on sponsor-finalization fencing,
policy/consent binding and the distinction between wallet uncertainty and a released
spending capability. Then authorize Asset Identity and Economic Intent Compatibility
V1 as a narrow versioned contract/fixture package. Keep provider installation,
mobile implementation, production signing and Mainnet activation outside it.

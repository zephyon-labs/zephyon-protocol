# Zephyon / ZephiPay Devnet Beta Readiness Log

Date: 2026-05-22
Protocol Repo Commit: 14d8552
Phase: Release Candidate Pre-Gauntlet

---

# Repository Integrity

## Git Status

* Working tree clean
* Frontend workspace properly ignored from protocol repo
* No untracked protocol files detected

## Workspace Notes

* Parent Git root currently exists at:
  `/home/zeranova/dev/zephyon`
* Protocol operations performed from:
  `/home/zeranova/dev/zephyon/zephyon-protocol`
* Frontend repository intentionally isolated from protocol tracking

---

# Anchor Build Verification

## Command

anchor build

## Result

PASS

## Notes

* Rust compile completed successfully
* Anchor build completed successfully
* No critical warnings observed
* Unit test initialization executed successfully

---

# Pending Validation Phases

* [ ] Frontend smoke test
* [ ] Recipient validation check
* [ ] Full protocol gauntlet
* [ ] Devnet script verification
* [ ] End-to-end frontend payment verification
* [ ] Warning review
* [ ] RC tag creation
* [ ] Public beta deployment readiness

---

# Warning Log

## Active Warnings

None currently documented.

---

# Release Decision

Status:
IN PROGRESS
## Attempt 1 — Devnet RPC Rate Limit

Command:
anchor test --skip-build

Result:
STOPPED MANUALLY

Reason:
Command used devnet provider from Anchor.toml and triggered repeated public RPC 429 Too Many Requests responses.

Decision:
Do not use public devnet for full local gauntlet. Re-run gauntlet using localnet provider override:

anchor test --skip-build --provider.cluster localnet
# Full Protocol Gauntlet

## Command

anchor test --skip-build --provider.cluster localnet

## Result

PASS

## Runtime

14355.65s (~3.99 hours)

## Total Tests

61 passing

---

# Major Validation Highlights

## Governance / Event Integrity

* TreasuryInitializedEvent verified
* TreasuryPausedSetEvent verified
* EventParser decoding verified
* Indexer-style log decoding verified

## Receipt Integrity

* Deterministic PDA derivation verified
* Nonce replay protection verified
* Stale receipt rejection verified
* Receipt ownership isolation verified

## Treasury & Authority Security

* Unauthorized withdraw rejection verified
* Unauthorized splPay rejection verified
* Pause-state enforcement verified
* Fake ATA rejection verified
* Wrong mint ATA rejection verified

## Stress & Concurrency Validation

* Tier1 pause gating proof passed
* Tier2 interleaved PAY/WITHDRAW/PAUSE chaos passed
* Tier3A multi-recipient pay storm passed
* Tier3B deterministic pause windows passed
* Tier3C multi-mint isolation passed
* Tier3E pause boundary semantics passed
* Tier3F stale receipt protection passed
* Tier4 adversarial scheduler passed

## Economic Validation

* Loop farming attack remained unprofitable
* Sybil attack simulation remained unprofitable
* Smart Sybil rotation remained unprofitable
* Arbitrage reward farming remained unprofitable

---

# Runtime Notes

## Tier3A Runtime

2611655ms (~43.5 minutes)

## Tier3B Runtime

1410245ms (~23.5 minutes)

## Tier3C Runtime

2272589ms (~37.9 minutes)

---

# Warnings Observed

## Node Warning

MODULE_TYPELESS_PACKAGE_JSON warning observed during ts-mocha execution.

Current impact:

* non-fatal
* performance overhead only

Future review recommended:

* evaluate ESM/CommonJS consistency

## Transaction Signature Deprecation Warning

Observed:
"Transaction references a signature that is unnecessary"

Current impact:

* non-fatal
* tests pass successfully

Future hardening task:

* remove unnecessary signer references before future major Solana/runtime upgrades

---

# Localnet Correction

Initial attempt using:
anchor test --skip-build

incorrectly targeted devnet provider from Anchor.toml and triggered RPC 429 rate limiting.

Corrected command:
anchor test --skip-build --provider.cluster localnet

Result:
Stable full-suite execution completed successfully.

---

# Release Candidate Assessment

Status:
PASS

Assessment:
Protocol demonstrates stable deterministic behavior under:

* concurrency stress,
* pause-state chaos,
* malformed transaction attempts,
* stale receipt replay attempts,
* adversarial scheduling,
* economic farming simulations.

Confidence Level:
High confidence for controlled devnet/public beta phase.

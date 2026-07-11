# Zephyon Protocol — Governance Model

## Authority
- A single **treasury authority** controls governance actions.
- Authority is enforced at the instruction level.

---

## Governance Actions

### Treasury Initialization
- Emits `TreasuryInitializedEvent`
- Records:
  - treasury PDA
  - authority
  - paused state
  - pay_count
  - slot and unix timestamp

### Pause / Unpause
- Executed via `setTreasuryPaused(bool)`
- Emits `TreasuryPausedSetEvent`
- Fully observable and indexer-readable

---

## Enforcement
- All asset-moving instructions check:
  - treasury pause state
  - signer authorization
- Unauthorized actions fail deterministically

---

## Governance Observability
Governance events are:
- asserted for presence
- asserted for semantic correctness
- validated for indexer decoding

This enables third-party monitoring and audit tooling.

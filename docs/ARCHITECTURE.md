# Zephyon Protocol — Architecture Overview

Scope note: this document describes the historical treasury/Anchor design. The
current TypeScript Devnet transfer lifecycle is documented in
[the durable submission contract](devnet-durable-submission-contract.md). The
[Mainnet P2P fund-authority ADR candidate](decisions/MAINNET_P2P_FUND_AUTHORITY_V1.md)
proposes customer authority and recovery requirements for independent review; it
approves no implementation or Mainnet activation.

## High-Level Goal
Zephyon is a Solana-based treasury protocol designed for secure asset custody,
governed transfers, and auditable value movement. The protocol emphasizes
determinism, observability, and safety over speculative behavior.

---

## Core Accounts

### Treasury
- **PDA-derived**
- Holds SPL assets
- Maintains global protocol state:
  - pause flag
  - pay_count
  - authority
- Single source of truth for funds

### User
- External signer
- Interacts with protocol via SPL deposit, withdraw, and payment flows

### Receipt (PDA)
- Deterministically derived
- Acts as an immutable audit artifact
- Used for replay protection and indexer compatibility

---

## Instruction Surface

| Instruction | Purpose |
|------------|--------|
| initializeTreasury | One-time treasury initialization |
| setTreasuryPaused | Governance control to halt operations |
| splDeposit | User → treasury asset movement |
| splDepositWithReceipt | Deposit with deterministic receipt |
| splWithdraw | Treasury → user withdrawal |
| splWithdrawWithReceipt | Withdrawal with receipt validation |
| splPay | Treasury → recipient payment |

---

## Design Principles
- **Append-only evolution** (no breaking reorder of enums/events)
- **Test-first behavior validation**
- **Event-driven observability**
- **Fail-closed security posture**

---

## Observability
All critical state transitions emit Anchor events, enabling:
- indexer consumption
- analytics
- audit trails

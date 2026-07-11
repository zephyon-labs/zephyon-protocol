# Zephyon Protocol — Security Model

## Security Philosophy
Zephyon prioritizes correctness, determinism, and explicit failure modes.
The protocol favors a conservative design over unchecked permissionlessness.

---

## Threats Addressed

### Unauthorized Withdrawals
- All withdrawals require treasury authority
- Enforced via signer checks
- Covered by negative-path tests

### Replay Attacks
- Receipt PDAs are deterministic
- Nonce- and counter-based derivation
- Replay attempts fail

### Fake ATA Injection
- ATA ownership and mint checks enforced
- Spoofed ATAs rejected

### State Desynchronization
- Single treasury PDA governs global state
- No duplicated authority state

---

## Emergency Controls
- Treasury pause halts:
  - deposits
  - withdrawals
  - payments
- Pause/unpause is observable and test-validated

---

## Out of Scope (Explicit)
- Key compromise of treasury authority
- External indexer correctness
- UI-level attack vectors

These are mitigated via operational controls and off-chain practices.

# Zephyon Protocol — Devnet Genesis

**Timestamp (CT):** Oct 30, 2025  
**Environment:**  
- WSL Ubuntu 24.04  
- Rust 1.82.0  
- Anchor 0.32.1  
- Solana CLI 1.18.26  
- Repo: zephyon-labs/zephyon-protocol  

---

## Program Deployment

**Program ID (Devnet):** 4u849yEmC4oRkBE2HcMCTYxuZuazPiqueps7XkCk16qx  
**Upgrade Authority:** DWLaEPUUyLgPqhoJDGni8PRaL58FdfSmXdL6Qtrp1hJ8  
**ProgramData Account:** 81QsnvQ5PkbxyjoGzHM3X6Tich1ESf2d92N3TW4ThUAr  
**Last Deployed Slot:** 418087176  
**Program Balance:** 1.3589052 SOL  

---

## IDL

File: `target/idl/zephyon_protocol.json`  
Instruction: `initialize` → creates a state account and stores data.  

---

## Anchor.toml Sync

```toml
[programs.devnet]
zephyon_protocol = "4u849yEmC4oRkBE2HcMCTYxuZuazPiqueps7XkCk16qx"


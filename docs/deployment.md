# Zephyon Protocol — Deployment Log

## Build State as of 10/26/2025

**Toolchain**
- rustc (project override): 1.90.0  
- Anchor CLI: 0.32.1  
- Solana CLI: 1.18.26  
- SBF builder reports legacy rustc 1.75.0-dev  

**Result**
- Anchor program: `zephyon_protocol`  
- Program ID: `GJXMamA3otLDDpbfzSZPeNhvzDBdeL1QhafSveKvwL2W`  
- Instruction: `initialize`  
- Account: `ProtocolState { value: u64 }`  
- Wallet: `/home/zeranova/.config/solana/id.json`

**Current State**
Build blocked by Solana's SBF toolchain still targeting rustc 1.75.0-dev while the project is on rustc 1.90.0.

**Next Actions**
1. Debug or upgrade Solana SBF builder to align with Rust ≥1.76.
2. Produce and capture `target/deploy/zephyon_protocol.so`.
3. Deploy to Devnet and log resulting Program ID and transaction signature here.


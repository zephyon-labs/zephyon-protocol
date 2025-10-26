# Zephyon Protocol (On-Chain Core)

# ⚡ Zephyon Labs
**Building AI-driven financial and human systems on Solana.**

Zephyon Labs develops **Zephyon Protocol** (policy-aware staking & payment rails) and **Nova / Anima Protocol** (AI presence & behavior engine).  

- Smart contract: `/programs/zephyon-protocol` (Anchor / Rust)
- First instruction: `initialize` creates a state account on-chain and stores data.
- First state struct: `ProtocolState { value: u64 }`
- Program ID (localnet/devnet placeholder): GJXMamA3otLDDpbfzSZPeNhvzDBdeL1QhafSveKvwL2W
- Wallet: /home/zeranova/.config/solana/id.json

Status (10/26/2025 America/Chicago):
- Wallet funded on devnet
- Anchor workspace initialized and wired to that wallet
- Program ID assigned
- Program skeleton implemented in Rust (Anchor)
- Build currently blocked by Solana's SBF toolchain still targeting rustc 1.75.0-dev, while local toolchain is rustc 1.90.0

Next Milestone:
- Resolve SBF/rustc mismatch and produce `target/deploy/zephyon_protocol.so`
- Deploy to devnet and log Program ID in docs/deployment.md

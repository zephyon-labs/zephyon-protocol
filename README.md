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
Status (10/30/2025 America/Chicago):

- Wallet funded on devnet
- Anchor workspace initialized and wired to that wallet
- Program deployed on Solana devnet
- Program ID: `4u849yEmC4oRkBE2HcMCTYxuZuazPiqueps7XkCk16qx`
- IDL generated: `target/idl/zephyon_protocol.json`
- Upgrade authority: controlled by Operator wallet
- Repo tagged: `v0.2-devnet-genesis`

Next Milestones:
1. Build minimal TypeScript client (sdk/ts) using the generated IDL.
2. Add first `initialize` call flow (state account init).
3. Write first Anchor test that hits devnet and asserts success.
4. Containerize environment for repeatable local onboarding.

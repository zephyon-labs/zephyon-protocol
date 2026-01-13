use anchor_lang::prelude::*;

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub treasury: Pubkey,

    // Optional “receipt” reference:
    // Pubkey::default() means “no receipt”
    pub receipt: Pubkey,

    // For deposit-with-receipt: nonce
    // For others: 0
    pub nonce_or_tx: u64,

    // Telemetry-first (grant safe)
    pub xp_delta: u32,   // start simple: 1
    pub risk_flags: u32, // start simple: 0

    pub slot: u64,
}

#[event]
pub struct WithdrawEvent {
    pub authority: Pubkey,
    pub user: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub treasury: Pubkey,

    // Pubkey::default() means “no receipt”
    pub receipt: Pubkey,

    // For withdraw-with-receipt: tx_count used to derive receipt
    // For others: 0
    pub nonce_or_tx: u64,

    pub xp_delta: u32,   // start simple: 1
    pub risk_flags: u32, // start simple: 0

    pub slot: u64,
}

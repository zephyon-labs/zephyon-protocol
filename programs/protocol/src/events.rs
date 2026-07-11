use anchor_lang::prelude::*;

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub treasury: Pubkey,
    pub direction: PayDirection,
    pub asset_kind: AssetKind,


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
    pub direction: PayDirection,
    pub asset_kind: AssetKind,


    // Pubkey::default() means “no receipt”
    pub receipt: Pubkey,

    // For withdraw-with-receipt: tx_count used to derive receipt
    // For others: 0
    pub nonce_or_tx: u64,

    pub xp_delta: u32,   // start simple: 1
    pub risk_flags: u32, // start simple: 0

    pub slot: u64,
}
#[event]
pub struct TreasuryInitializedEvent {
    pub treasury: Pubkey,
    pub authority: Pubkey,

    pub paused: bool,
    pub bump: u8,
    pub pay_count: u64,

    pub slot: u64,
    pub unix_timestamp: i64,
}

#[event]
pub struct TreasuryPausedSetEvent {
    pub treasury: Pubkey,
    pub authority: Pubkey,

    pub paused: bool,

    pub slot: u64,
    pub unix_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PayDirection {
    TreasuryToRecipient,
    RecipientToTreasury,

    // Core24 additions (APPEND ONLY — do not reorder)
    UserToTreasury,
    TreasuryToUser,
}


#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AssetKind {
    SPL,
}

#[event]
pub struct SplPayEvent {
    pub pay_count: u64,

    pub treasury: Pubkey,
    pub treasury_authority: Pubkey,
    pub recipient: Pubkey,

    pub receipt: Pubkey,

    pub direction: PayDirection,
    pub asset_kind: AssetKind,


    pub mint: Pubkey,
    pub amount: u64,

    pub has_reference: bool,
    pub reference: [u8; 32],

    pub has_memo: bool,
    pub memo_len: u8,
    pub slot: u64,

    pub unix_timestamp: i64,
}


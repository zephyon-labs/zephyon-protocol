use anchor_lang::prelude::*;

#[account]
pub struct Receipt {
    /// User wallet (NOT the user_profile PDA)
    pub user: Pubkey,

    /// 0 = deposit, 1 = withdraw
    pub direction: u8,

    /// 0 = SOL, 1 = SPL
    pub asset_kind: u8,

    /// SPL mint, or Pubkey::default() for SOL
    pub mint: Pubkey,

    /// Amount transferred (lamports for SOL, raw token units for SPL)
    pub amount: u64,

    /// Fee charged (same unit as amount; 0 for now if unused)
    pub fee: u64,

    /// User balance before (same unit as amount; for SPL, token units in user ATA)
    pub pre_balance: u64,

    /// User balance after (same unit as amount; for SPL, token units in user ATA)
    pub post_balance: u64,

    /// Unix timestamp at receipt creation
    pub ts: i64,

    /// Snapshot of user_profile.tx_count BEFORE increment
    pub tx_count: u64,

    /// PDA bump
    pub bump: u8,

    /// Extensible payload
    pub v2: ReceiptV2Ext,
}

impl Receipt {
    pub const DIR_DEPOSIT: u8 = 0;
    pub const DIR_WITHDRAW: u8 = 1;

    pub const ASSET_SOL: u8 = 0;
    pub const ASSET_SPL: u8 = 1;

    /// Space excluding the 8-byte discriminator (Anchor adds that separately in init via `space = 8 + ...`)
    pub const LEN: usize =
        32 + // user
        1  + // direction
        1  + // asset_kind
        32 + // mint
        8  + // amount
        8  + // fee
        8  + // pre_balance
        8  + // post_balance
        8  + // ts (i64)
        8  + // tx_count
        1  + // bump
        ReceiptV2Ext::LEN;

    /// Convenience for `space = 8 + Receipt::LEN`
    pub const SPACE: usize = 8 + Self::LEN;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct ReceiptV2Ext {
    /// Reserved flags for future (bitfield)
    pub flags: u16,

    /// Optional: keep if you want future-proof explicit SPL mint storage.
    /// Redundant with `mint`, but harmless.
    pub spl_mint: Pubkey,
}

impl ReceiptV2Ext {
    pub const LEN: usize = 2 + 32;

    pub fn sol() -> Self {
        Self { flags: 0, spl_mint: Pubkey::default() }
    }

    pub fn spl(mint: Pubkey) -> Self {
        Self { flags: 0, spl_mint: mint }
    }
}

#[event]
pub struct ReceiptCreated {
    pub user: Pubkey,
    pub direction: u8,
    pub asset_kind: u8,
    pub mint: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub pre_balance: u64,
    pub post_balance: u64,
    pub ts: i64,
    pub tx_count: u64,
}



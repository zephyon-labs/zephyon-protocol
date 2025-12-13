use anchor_lang::prelude::*;

#[account]
pub struct Receipt {
    pub user: Pubkey,        // PDA of UserProfile
    pub direction: u8,       // 0 = deposit, 1 = withdraw
    pub asset_kind: u8,      // 0 = SOL, 1 = SPL
    pub mint: Pubkey,        // SPL mint or default() for SOL
    pub amount: u64,
    pub fee: u64,
    pub pre_balance: u64,
    pub post_balance: u64,
    pub ts: i64,
    pub tx_count: u64,       // snapshot of profile.tx_count BEFORE increment
    pub bump: u8,
    pub v2: ReceiptV2Ext,    // extensible payload
}
impl Receipt {
    pub const SPACE: usize =
        8  + // anchor
        32 + 1 + 1 + 32 +
        8 + 8 + 8 + 8 +
        8 + 1 +
        ReceiptV2Ext::SPACE;

    pub const DIR_DEPOSIT: u8 = 0;
    pub const DIR_WITHDRAW: u8 = 1;

    pub const ASSET_SOL: u8 = 0;
    pub const ASSET_SPL: u8 = 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct ReceiptV2Ext {
    pub flags: u16,    // reserved for future
    pub spl_mint: Pubkey, // when ASSET_SPL, set to mint; else default
}
impl ReceiptV2Ext {
    pub const SPACE: usize = 2 + 32;

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



use anchor_lang::prelude::*;

#[account]
pub struct UserAccount {
    /// The wallet that controls this user profile in Zephyon.
    pub owner: Pubkey,

    /// Protocol-tracked balance for this user (in lamports or tokens).
    pub balance_lamports: u64,

    /// Safety / compliance switch. If true, no deposits/withdrawals allowed.
    pub frozen: bool,

    /// PDA bump used when deriving this account address.
    pub bump: u8,

    /// Schema / migration version.
    pub version: u8,
}

use anchor_lang::prelude::*;

/// PDA that tracks a user's activity with the protocol (deposit/withdraw, SOL/SPL).
/// One per user wallet.
#[account]
pub struct UserProfile {
    /// Wallet this profile belongs to
    pub authority: Pubkey,

    /// Total number of protocol transactions performed by this user
    /// (deposit + withdraw, SOL + SPL)
    pub tx_count: u64,

    /// PDA bump
    pub bump: u8,
}

impl UserProfile {
    /// Total bytes for account allocation (INCLUDING discriminator)
    pub const LEN: usize = 8  // discriminator
        + 32 // authority
        + 8  // tx_count
        + 1; // bump
}

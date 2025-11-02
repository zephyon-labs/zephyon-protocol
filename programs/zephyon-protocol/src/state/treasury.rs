use anchor_lang::prelude::*;

#[account]
pub struct Treasury {
    /// The program authority that can withdraw or manage funds (for now this will be you)
    pub authority: Pubkey,
    /// Total amount of lamports ever deposited into the protocol
    pub total_deposits: u64,
    /// Bump used for PDA derivation
    pub bump: u8,
}

impl Treasury {
    pub const LEN: usize = 8 + 32 + 8 + 1; // discriminator + authority + total_deposits + bump
}

use anchor_lang::prelude::*;

/// Global protocol treasury PDA state.
/// This account represents the "vault authority" for SPL custody.
/// The PDA itself signs CPI transfers via seeds + bump.
#[account]
pub struct Treasury {
    /// Authority allowed to perform privileged actions (e.g., withdraw).
    pub authority: Pubkey,
    pub paused: bool, // NEW
    pub bump: u8,
    pub pay_count: u64,

}

impl Treasury {
    /// Anchor account discriminator (8) + Pubkey (32) + u8 (1)
    pub const INIT_SPACE: usize = 8 + 32 + 1 + 1 + 8;


    /// Convenience initializer for consistent state creation.
    pub fn initialize(&mut self, authority: Pubkey, bump: u8) {
    self.authority = authority;
    self.paused = false;
    self.bump = bump;
    self.pay_count = 0;
  }

}

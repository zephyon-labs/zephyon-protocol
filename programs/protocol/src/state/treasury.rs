use anchor_lang::prelude::*;

/// Global protocol treasury PDA state.
///
/// This account represents the canonical treasury authority used by the
/// protocol for privileged treasury actions and PDA-signed SPL transfers.
///
/// Current responsibilities:
/// - stores the configured treasury authority
/// - stores the global paused flag
/// - stores the treasury PDA bump
/// - stores the monotonic SPL pay counter used for pay receipt indexing
#[account]
pub struct Treasury {
    /// Authority allowed to perform privileged treasury actions.
    pub authority: Pubkey,

    /// Global protocol pause flag.
    ///
    /// When true, treasury-gated value-moving instructions must reject.
    pub paused: bool,

    /// PDA bump for the canonical treasury account.
    pub bump: u8,

    /// Monotonic counter for SPL pay receipt indexing.
    ///
    /// Current SPL pay receipts are derived using:
    /// ["receipt", treasury.key(), pay_count_before.to_le_bytes()]
    ///
    /// This counter must increase exactly once for each successful SPL pay.
    pub pay_count: u64,
}

impl Treasury {
    /// Full Anchor account space including discriminator.
    ///
    /// Layout:
    /// - discriminator: 8
    /// - authority: 32
    /// - paused: 1
    /// - bump: 1
    /// - pay_count: 8
    pub const INIT_SPACE: usize = 8 + 32 + 1 + 1 + 8;

    /// Initialize treasury state with a configured authority and PDA bump.
    pub fn initialize(&mut self, authority: Pubkey, bump: u8) {
        self.authority = authority;
        self.paused = false;
        self.bump = bump;
        self.pay_count = 0;
    }
}

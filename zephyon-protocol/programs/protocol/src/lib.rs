#![allow(clippy::result_large_err)]

use anchor_lang::prelude::*;

// Anchor IDL/client-account codegen expects this alias to exist.
// Without it you get "__client_accounts_* not found" and #[program] goes red.
extern crate self as __client_accounts_protocol;

pub mod state;
pub mod instructions;

// Re-export so Context<InitializeTreasury> etc can be referenced directly
pub use instructions::*;

use state::treasury::Treasury;

declare_id!("C3irtmDDybjBXrYYh1mFj9eBVRhKSeA6JX356NrVThyo");

#[program]
pub mod protocol {
    use super::*;

    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        let t = &mut ctx.accounts.treasury;
        t.authority = ctx.accounts.authority.key();
        t.bump = ctx.bumps.treasury;
        Ok(())
    }

    pub fn deposit_spl(ctx: Context<SplDeposit>, amount: u64) -> Result<()> {
        instructions::spl_deposit::handler(ctx, amount)
    }
}











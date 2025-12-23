#![allow(clippy::result_large_err)]

use anchor_lang::prelude::*;

// Anchor IDL/client-account codegen expects this alias to exist.
// Without it you get "__client_accounts_* not found" and #[program] goes red.
extern crate self as __client_accounts_protocol;

pub mod state;
pub mod instructions;

// Re-export so Context<InitializeTreasury>, Context<SplDeposit>, Context<SplWithdraw> etc can be referenced directly
pub use instructions::*;

declare_id!("7Huo5pfufAtTyPufiZ9XZGcRLHZyPcnbsjyCDYk8G8iB");

#[program]
pub mod protocol {
    use super::*;

    // ─────────────────────────────────────────────────────────────────────────
    // Core12 — Treasury
    // ─────────────────────────────────────────────────────────────────────────
    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        let t = &mut ctx.accounts.treasury;
        t.authority = ctx.accounts.authority.key();
        t.bump = ctx.bumps.treasury;
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Core12 — SPL Deposit
    // ─────────────────────────────────────────────────────────────────────────
    pub fn deposit_spl(ctx: Context<SplDeposit>, amount: u64) -> Result<()> {
        instructions::spl_deposit::handler(ctx, amount)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Core12 — SPL Withdraw
    // ─────────────────────────────────────────────────────────────────────────
    pub fn withdraw_spl(ctx: Context<SplWithdraw>, amount: u64) -> Result<()> {
        instructions::spl_withdraw::handler(ctx, amount)
    }
}












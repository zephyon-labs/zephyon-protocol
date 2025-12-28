#![allow(clippy::result_large_err)]

use anchor_lang::prelude::*;

pub mod state;
pub mod instructions;
// Anchor macro bridge (crate-private)
// Re-export the generated __client_accounts_* so #[program] can find them at crate root.
pub(crate) use instructions::initialize_treasury::__client_accounts_initialize_treasury;
pub(crate) use instructions::spl_deposit::__client_accounts_spl_deposit;
pub(crate) use instructions::spl_withdraw::__client_accounts_spl_withdraw;

declare_id!("7Huo5pfufAtTyPufiZ9XZGcRLHZyPcnbsjyCDYk8G8iB");
use crate::instructions::{
    InitializeTreasury,
    SplDeposit,
    SplWithdraw,
};

#[program]
pub mod protocol {
    use super::*;
    use crate::instructions::{InitializeTreasury, SplDeposit, SplWithdraw};

    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        crate::instructions::initialize_treasury::handler(ctx)
    }

    pub fn spl_deposit(ctx: Context<SplDeposit>, amount: u64) -> Result<()> {
        crate::instructions::spl_deposit::handler(ctx, amount)
    }

    pub fn spl_withdraw(ctx: Context<SplWithdraw>, amount: u64) -> Result<()> {
        crate::instructions::spl_withdraw::handler(ctx, amount)
    }
}






















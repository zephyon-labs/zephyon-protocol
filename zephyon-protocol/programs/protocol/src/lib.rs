#![allow(clippy::result_large_err)]

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

// Anchor macro bridge (crate-private)
// Re-export the generated __client_accounts_* so #[program] can find them at crate root.
pub(crate) use instructions::initialize_treasury::__client_accounts_initialize_treasury;
pub(crate) use instructions::set_treasury_paused::__client_accounts_set_treasury_paused;
pub(crate) use instructions::spl_deposit::__client_accounts_spl_deposit;
pub(crate) use instructions::spl_deposit_with_receipt::__client_accounts_spl_deposit_with_receipt;
pub(crate) use instructions::spl_withdraw::__client_accounts_spl_withdraw;
pub(crate) use instructions::spl_withdraw_with_receipt::__client_accounts_spl_withdraw_with_receipt;

declare_id!("7Huo5pfufAtTyPufiZ9XZGcRLHZyPcnbsjyCDYk8G8iB");
use crate::instructions::{
    InitializeTreasury, SetTreasuryPaused, SplDeposit, SplDepositWithReceipt, SplWithdraw,
    SplWithdrawWithReceipt,
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

    pub fn spl_deposit_with_receipt(
        ctx: Context<SplDepositWithReceipt>,
        amount: u64,
        nonce: u64,
    ) -> Result<()> {
        instructions::spl_deposit_with_receipt::handler(ctx, amount, nonce)
    }

    pub fn spl_withdraw_with_receipt(
        ctx: Context<SplWithdrawWithReceipt>,
        amount: u64,
    ) -> Result<()> {
        instructions::spl_withdraw_with_receipt::handler(ctx, amount)
    }

    pub fn spl_withdraw(ctx: Context<SplWithdraw>, amount: u64) -> Result<()> {
        crate::instructions::spl_withdraw::handler(ctx, amount)
    }

    pub fn set_treasury_paused(ctx: Context<SetTreasuryPaused>, paused: bool) -> Result<()> {
        instructions::set_treasury_paused::handler(ctx, paused)
    }
}

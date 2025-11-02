use anchor_lang::prelude::*;
use crate::state::*; // Treasury, UserAccount

#[derive(Accounts)]
pub struct Deposit<'info> {
    /// The user sending lamports
    #[account(mut)]
    pub signer: Signer<'info>,

    /// The user’s account that tracks their balance in the protocol
    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,

    /// Global treasury PDA for the protocol
    #[account(mut)]
    pub treasury: Account<'info, Treasury>,

    /// System program (will be used for actual lamport transfer in next phase)
    pub system_program: Program<'info, System>,
}

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let user = &mut ctx.accounts.user_account;
    let treasury = &mut ctx.accounts.treasury;

    // Add to user's tracked balance
    user.balance_lamports = user
        .balance_lamports
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    // Add to protocol's total tracked deposits
    treasury.total_deposits = treasury
        .total_deposits
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Math overflow detected")]
    MathOverflow,
}


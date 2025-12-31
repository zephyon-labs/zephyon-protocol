use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::state::treasury::Treasury;

#[derive(Accounts)]
pub struct SplWithdraw<'info> {
    /// User receiving the tokens
    #[account(mut)]
    pub user: Signer<'info>,

    /// Treasury PDA (already initialized)
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump
    )]
    pub treasury: Account<'info, Treasury>,

    /// SPL mint being withdrawn
    pub mint: Account<'info, Mint>,

    /// User ATA for that mint (create if missing)
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user
    )]
    pub user_ata: Account<'info, TokenAccount>,

    /// Treasury ATA for that mint
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = treasury
    )]
    pub treasury_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<SplWithdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    // Treasury PDA signs for transfer out
    let bump = ctx.accounts.treasury.bump;
    let seeds: &[&[u8]] = &[b"treasury", &[bump]];
    let signer = &[seeds];

    let cpi_accounts = Transfer {
        from: ctx.accounts.treasury_ata.to_account_info(),
        to: ctx.accounts.user_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };

    let cpi_ctx =
        CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer);

    token::transfer(cpi_ctx, amount)?;

    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Amount must be greater than 0")]
    InvalidAmount,
}



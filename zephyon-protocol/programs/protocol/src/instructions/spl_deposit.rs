use anchor_lang::prelude::*;

use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};
use crate::events::DepositEvent;
use crate::errors::ErrorCode;


use crate::state::treasury::Treasury;

#[event]
pub struct SplDepositEvent {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub treasury: Pubkey,
    pub treasury_ata: Pubkey,
}

#[derive(Accounts)]
pub struct SplDeposit<'info> {
    /// User paying the tokens
    #[account(mut)]
    pub user: Signer<'info>,

    /// Treasury PDA (must already exist from initialize_treasury)
    #[account(
        mut,
        seeds = [b"treasury"],
        bump
    )]
    pub treasury: Account<'info, Treasury>,

    /// SPL mint being deposited (e.g., USDC)
    pub mint: Account<'info, Mint>,

    /// User's ATA for this mint
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user
    )]
    pub user_ata: Account<'info, TokenAccount>,

    /// Treasury's ATA for this mint (created if missing)
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = treasury
    )]
    pub treasury_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<SplDeposit>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.treasury.paused, ErrorCode::ProtocolPaused);
    require!(amount > 0, ErrorCode::InvalidAmount);


    // Transfer from user ATA -> treasury ATA
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_ata.to_account_info(),
        to: ctx.accounts.treasury_ata.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    let slot = Clock::get()?.slot;

    emit!(DepositEvent {
        user: ctx.accounts.user.key(),
        mint: ctx.accounts.user_ata.mint, // or whichever token account is present
        amount,
        treasury: ctx.accounts.treasury.key(),
        receipt: Pubkey::default(),
        nonce_or_tx: 0,
        xp_delta: 1,
        risk_flags: 0,
        slot,
    });


    emit!(SplDepositEvent {
        user: ctx.accounts.user.key(),
        mint: ctx.accounts.mint.key(),
        amount,
        treasury: ctx.accounts.treasury.key(),
        treasury_ata: ctx.accounts.treasury_ata.key(),
    });

    Ok(())
}









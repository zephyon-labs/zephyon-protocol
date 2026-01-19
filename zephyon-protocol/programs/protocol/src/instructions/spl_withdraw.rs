use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::errors::ErrorCode;
use crate::events::WithdrawEvent;
use crate::state::treasury::Treasury;

#[derive(Accounts)]
pub struct SplWithdraw<'info> {
    /// Treasury authority allowed to withdraw (must match treasury.authority)
    #[account(mut)]
    pub treasury_authority: Signer<'info>,

    /// Recipient wallet receiving the tokens (does not need to sign)
    /// CHECK: Only used as ATA authority; constrained by `user_ata` below.
    pub user: UncheckedAccount<'info>,

    /// Treasury PDA (already initialized)
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump,
        constraint = !treasury.paused @ ErrorCode::ProtocolPaused
    )]
    pub treasury: Account<'info, Treasury>,

    /// SPL mint being withdrawn
    pub mint: Account<'info, Mint>,

    /// Recipient ATA for that mint (create if missing; paid by treasury_authority)
    #[account(
        init_if_needed,
        payer = treasury_authority,
        associated_token::mint = mint,
        associated_token::authority = user,
        constraint = user_ata.owner == user.key() @ ErrorCode::InvalidUserTokenAccountOwner,
        constraint = user_ata.mint == mint.key() @ ErrorCode::InvalidMint
    )]
    pub user_ata: Account<'info, TokenAccount>,

    /// Treasury ATA for that mint
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = treasury,
        constraint = treasury_ata.owner == treasury.key() @ ErrorCode::InvalidTreasuryTokenAccountOwner,
        constraint = treasury_ata.mint == mint.key() @ ErrorCode::InvalidMint
    )]
    pub treasury_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<SplWithdraw>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.treasury.paused, ErrorCode::ProtocolPaused);
    require!(amount > 0, ErrorCode::InvalidAmount);

    // Only the treasury authority can initiate withdrawals
    require_keys_eq!(
        ctx.accounts.treasury_authority.key(),
        ctx.accounts.treasury.authority,
        ErrorCode::UnauthorizedWithdraw
    );

    // Treasury PDA signs for transfer out
    let bump = ctx.accounts.treasury.bump;
    let seeds: &[&[u8]] = &[b"treasury", &[bump]];
    let signer = &[seeds];

    let cpi_accounts = Transfer {
        from: ctx.accounts.treasury_ata.to_account_info(),
        to: ctx.accounts.user_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer,
    );

    token::transfer(cpi_ctx, amount)?;

    let slot = Clock::get()?.slot;

    emit!(WithdrawEvent {
        authority: ctx.accounts.treasury_authority.key(),
        user: ctx.accounts.user.key(),
        mint: ctx.accounts.user_ata.mint, // again: depends on your naming
        amount,
        treasury: ctx.accounts.treasury.key(),
        receipt: Pubkey::default(),
        nonce_or_tx: 0,
        xp_delta: 1,
        risk_flags: 0,
        slot,
    });
    Ok(())
}

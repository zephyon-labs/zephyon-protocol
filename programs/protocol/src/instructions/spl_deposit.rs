use anchor_lang::prelude::*;
use anchor_spl::token::spl_token;

use crate::errors::ErrorCode;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::events::{DepositEvent, AssetKind, PayDirection};


use crate::state::treasury::Treasury;



#[derive(Accounts)]
pub struct SplDeposit<'info> {
    /// User paying the tokens
    #[account(mut)]
    pub user: Signer<'info>,

    /// Treasury PDA (must already exist from initialize_treasury)
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = !treasury.paused @ ErrorCode::ProtocolPaused
    )]
    pub treasury: Account<'info, Treasury>,

    /// SPL mint being deposited (e.g., USDC)
    pub mint: Account<'info, Mint>,

    /// User's ATA for this mint
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
        constraint = user_ata.owner == user.key() @ ErrorCode::InvalidUserTokenAccountOwner,
        constraint = user_ata.mint == mint.key() @ ErrorCode::InvalidMint
    )]
    pub user_ata: Account<'info, TokenAccount>,

    /// Treasury's ATA for this mint (created if missing)
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = treasury,
        constraint = treasury_ata.owner == treasury.key() @ ErrorCode::InvalidTreasuryTokenAccountOwner,
        constraint = treasury_ata.mint == mint.key() @ ErrorCode::InvalidMint
        

    )]
    pub treasury_ata: Account<'info, TokenAccount>,

    #[account(address = spl_token::ID)]
    pub token_program: Program<'info, Token>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<SplDeposit>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);
    require!(
        ctx.accounts.user_ata.amount >= amount,
        ErrorCode::InsufficientFunds
    );

    // Transfer from user ATA -> treasury ATA
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_ata.to_account_info(),
        to: ctx.accounts.treasury_ata.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    // Recommend: keep ONE canonical event (SplDepositEvent) until receipts/XP/risk are real.
    let slot = Clock::get()?.slot;

    emit!(DepositEvent {
        user: ctx.accounts.user.key(),
        mint: ctx.accounts.mint.key(),
        amount,
        treasury: ctx.accounts.treasury.key(),
        direction: PayDirection::UserToTreasury,
        asset_kind: AssetKind::SPL,
        receipt: Pubkey::default(),
        nonce_or_tx: 0,
        xp_delta: 1,
        risk_flags: 0,
        slot,
    });


    Ok(())
}

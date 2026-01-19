use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::errors::ErrorCode;
use crate::events::WithdrawEvent;
use crate::state::{Receipt, ReceiptV2Ext, Treasury, UserProfile};

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct SplWithdrawWithReceipt<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// Must match treasury.authority (admin signer)
    pub treasury_authority: Signer<'info>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserProfile::LEN,
        seeds = [b"user_profile", user.key().as_ref()],
        bump
    )]
    pub user_profile: Account<'info, UserProfile>,

    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump,
        constraint = !treasury.paused @ ErrorCode::ProtocolPaused
    )]
    pub treasury: Account<'info, Treasury>,

    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user,
        constraint = user_ata.owner == user.key() @ ErrorCode::InvalidUserTokenAccountOwner,
        constraint = user_ata.mint == mint.key() @ ErrorCode::InvalidMint
    )]
    pub user_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = treasury,
        constraint = treasury_ata.owner == treasury.key() @ ErrorCode::InvalidTreasuryTokenAccountOwner,
        constraint = treasury_ata.mint == mint.key() @ ErrorCode::InvalidMint
    )]
    pub treasury_ata: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        space = 8 + Receipt::LEN,
        seeds = [b"receipt", user.key().as_ref(), &user_profile.tx_count.to_le_bytes()],
        bump
    )]
    pub receipt: Account<'info, Receipt>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<SplWithdrawWithReceipt>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    // Initialize or verify user_profile ownership.
    if ctx.accounts.user_profile.authority == Pubkey::default() {
        ctx.accounts.user_profile.authority = ctx.accounts.user.key();
        ctx.accounts.user_profile.tx_count = 0;
        ctx.accounts.user_profile.bump = ctx.bumps.user_profile;
    } else {
        require_keys_eq!(
            ctx.accounts.user_profile.authority,
            ctx.accounts.user.key(),
            ErrorCode::InvalidUserProfileAuthority
        );
    }

    // Admin gate: must be treasury authority
    require_keys_eq!(
        ctx.accounts.treasury_authority.key(),
        ctx.accounts.treasury.authority,
        ErrorCode::UnauthorizedWithdraw
    );

    // Pre-increment tx_count (used for seed + receipt invariant)
    let tx_count = ctx.accounts.user_profile.tx_count;

    // Treasury PDA signs the token transfer
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

    // Write receipt (tx_count must reflect PRE-increment)
    let r = &mut ctx.accounts.receipt;
    r.user = ctx.accounts.user.key();
    r.direction = Receipt::DIR_WITHDRAW;
    r.asset_kind = Receipt::ASSET_SPL;
    r.mint = ctx.accounts.mint.key();
    r.amount = amount;
    r.fee = 0;
    r.pre_balance = 0;
    r.post_balance = 0;
    r.ts = Clock::get()?.unix_timestamp;
    r.tx_count = tx_count;
    r.bump = ctx.bumps.receipt;
    r.v2 = ReceiptV2Ext::spl(ctx.accounts.mint.key());

    // Increment AFTER receipt is written
    ctx.accounts.user_profile.tx_count = ctx.accounts
        .user_profile
        .tx_count
        .saturating_add(1);

    let slot = Clock::get()?.slot;

    emit!(WithdrawEvent {
        authority: ctx.accounts.treasury_authority.key(),
        user: ctx.accounts.user.key(),
        mint: ctx.accounts.user_ata.mint,
        amount,
        treasury: ctx.accounts.treasury.key(),
        receipt: ctx.accounts.receipt.key(),
        nonce_or_tx: tx_count, // <- pre-increment (matches receipt seed invariant)
        xp_delta: 1,
        risk_flags: 0,
        slot,
    });

    Ok(())
}


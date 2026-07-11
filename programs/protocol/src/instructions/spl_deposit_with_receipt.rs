use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::errors::ErrorCode;
use crate::state::{Receipt, ReceiptV2Ext, Treasury};
use crate::events::{DepositEvent, AssetKind, PayDirection};
#[derive(Accounts)]
#[instruction(amount: u64, nonce: u64)]
pub struct SplDepositWithReceipt<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump
    )]
    pub treasury: Account<'info, Treasury>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user
    )]
    pub user_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = treasury
    )]
    pub treasury_ata: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        space = 8 + Receipt::LEN,
        seeds = [b"receipt", user.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub receipt: Account<'info, Receipt>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<SplDepositWithReceipt>, amount: u64, nonce: u64) -> Result<()> {
    require!(!ctx.accounts.treasury.paused, ErrorCode::ProtocolPaused);
    require!(amount > 0, ErrorCode::InvalidAmount);

    // SPL transfer: user -> treasury
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_ata.to_account_info(),
        to: ctx.accounts.treasury_ata.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    // Write receipt (immutable fact record)
    let r = &mut ctx.accounts.receipt;

    r.user = ctx.accounts.user.key();
    r.direction = Receipt::DIR_DEPOSIT;
    r.asset_kind = Receipt::ASSET_SPL;
    r.mint = ctx.accounts.mint.key();
    r.amount = amount;
    r.fee = 0;
    r.pre_balance = 0; // optional for now
    r.post_balance = 0; // optional for now
    r.ts = Clock::get()?.unix_timestamp;

    // Reuse tx_count field as a generic nonce for deposit receipts.
    // (Keeps Receipt layout stable without introducing new fields.)
    r.tx_count = nonce;

    r.bump = ctx.bumps.receipt;
    r.v2 = ReceiptV2Ext::spl(ctx.accounts.mint.key());

    let slot = Clock::get()?.slot;

    emit!(DepositEvent {
        user: ctx.accounts.user.key(),
        mint: ctx.accounts.user_ata.mint,
        amount,
        treasury: ctx.accounts.treasury.key(),
        direction: PayDirection::UserToTreasury,
        asset_kind: AssetKind::SPL,

        receipt: ctx.accounts.receipt.key(),
        nonce_or_tx: nonce, // assuming your arg is named nonce
        xp_delta: 1,
        risk_flags: 0,
        slot,
    });
    Ok(())
}

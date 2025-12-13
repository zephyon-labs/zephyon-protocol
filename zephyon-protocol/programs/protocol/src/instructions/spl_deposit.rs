use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer as SplTransfer};

use crate::{ProtocolState, UserProfile, Receipt, ReceiptV2Ext, ZephyonError};
use crate::state::receipt::ReceiptCreated;

#[derive(Accounts)]
pub struct SplDeposit<'info> {
    // — protocol graph —
    #[account(has_one = treasury @ ZephyonError::InvalidTreasuryPda)]
    pub protocol_state: Account<'info, ProtocolState>,

    /// CHECK: PDA owner of the treasury ATA (off-curve)
    #[account(
        mut,
        seeds = [b"zephyon_treasury"],
        bump
    )]
    pub treasury: AccountInfo<'info>,

    // — user profile —
    #[account(
        mut,
        seeds = [
            b"user_profile",
            protocol_state.key().as_ref(),
            user.key().as_ref()
        ],
        bump = user_profile.bump,
        constraint = user_profile.authority == user.key() @ ZephyonError::Unauthorized
    )]
    pub user_profile: Account<'info, UserProfile>,

    // — receipt (PRE-increment) —
    #[account(
        init,
        payer = user,
        space = Receipt::SPACE,
        seeds = [
            b"receipt",
            user_profile.key().as_ref(),
            &user_profile.tx_count.to_le_bytes()
        ],
        bump
    )]
    pub receipt: Account<'info, Receipt>,

    // — SPL stack —
    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(mut, constraint = user_token.mint == mint.key())]
    pub user_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = treasury_token.mint == mint.key(),
        // treasury_token.owner MUST be the treasury PDA (off-curve)
        constraint = treasury_token.owner == treasury.key()
    )]
    pub treasury_token: Account<'info, TokenAccount>,

    // — signer & programs —
    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SplDeposit>, amount_tokens: u64) -> Result<()> {
    require!(amount_tokens > 0, ZephyonError::InsufficientFunds);

    // 1) token transfer: user -> treasury ATA
    let cpi_accounts = SplTransfer {
        from: ctx.accounts.user_token.to_account_info(),
        to:   ctx.accounts.treasury_token.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount_tokens)?;

    // 2) update profile
    let p = &mut ctx.accounts.user_profile;
    p.deposit_count = p.deposit_count.saturating_add(1);
    p.total_deposited = p
        .total_deposited
        .checked_add(amount_tokens)
        .ok_or(ZephyonError::MathOverflow)?;
    p.last_deposit_at = Clock::get()?.unix_timestamp;

    // 3) write receipt snapshot (PRE-increment)
    let pre_balance = p
        .total_deposited
        .checked_sub(amount_tokens)
        .ok_or(ZephyonError::MathOverflow)?;
    let r = &mut ctx.accounts.receipt;
    r.user         = p.key();                 // store user_profile PDA (canonical)
    r.direction    = Receipt::DIR_DEPOSIT;
    r.asset_kind   = Receipt::ASSET_SPL;
    r.mint         = ctx.accounts.mint.key();
    r.amount       = amount_tokens;
    r.fee          = 0;
    r.pre_balance  = pre_balance;
    r.post_balance = p.total_deposited;
    r.ts           = p.last_deposit_at;
    r.tx_count     = p.tx_count;
    r.bump         = ctx.bumps.receipt;
    r.v2           = ReceiptV2Ext::spl(ctx.accounts.mint.key());

    emit!(ReceiptCreated {
        user:        r.user,
        direction:   r.direction,
        asset_kind:  r.asset_kind,
        mint:        r.mint,
        amount:      r.amount,
        fee:         r.fee,
        pre_balance: r.pre_balance,
        post_balance:r.post_balance,
        ts:          r.ts,
        tx_count:    r.tx_count,
    });

    // 4) bump tx_count AFTER receipt
    p.tx_count = p.tx_count.saturating_add(1);
    Ok(())
}





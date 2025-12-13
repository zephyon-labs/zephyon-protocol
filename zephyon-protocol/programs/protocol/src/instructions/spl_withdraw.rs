use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer as SplTransfer};

use crate::{ProtocolState, UserProfile, Receipt, ReceiptV2Ext, ZephyonError};

#[derive(Accounts)]
pub struct SplWithdraw<'info> {
    // protocol graph
    #[account(has_one = treasury @ ZephyonError::InvalidTreasuryPda)]
    pub protocol_state: Account<'info, ProtocolState>,

    /// CHECK: PDA; owner of treasury_ata and signer via seeds
    #[account(
        mut,
        seeds = [b"zephyon_treasury"],
        bump
    )]
    pub treasury: AccountInfo<'info>,

    // profile
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

    // receipt
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

    // SPL stack
    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_token.mint == mint.key()
    )]
    pub user_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = treasury_token.mint == mint.key(),
        constraint = treasury_token.owner == treasury.key()
    )]
    pub treasury_token: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SplWithdraw>, amount_tokens: u64) -> Result<()> {
    require!(amount_tokens > 0, ZephyonError::InsufficientFunds);
    require!(
        ctx.accounts.treasury_token.amount >= amount_tokens,
        ZephyonError::InsufficientFunds
    );

    // program signs with treasury PDA seeds — give them a stable lifetime
    let bump = ctx.bumps.treasury;
    let bump_arr = [bump];
    let seeds: [&[u8]; 2] = [b"zephyon_treasury", &bump_arr];
    let signer_seeds: &[&[&[u8]]] = &[&seeds];

    let cpi_accounts = SplTransfer {
        from: ctx.accounts.treasury_token.to_account_info(),
        to:   ctx.accounts.user_token.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer(cpi_ctx, amount_tokens)?;

    // counters
    let p = &mut ctx.accounts.user_profile;
    let now = Clock::get()?.unix_timestamp;
    p.withdraw_count = p.withdraw_count.saturating_add(1);
    p.total_withdrawn = p.total_withdrawn
        .checked_add(amount_tokens)
        .ok_or(ZephyonError::MathOverflow)?;
    p.last_withdraw_at = now;

    // receipt
    let pre_balance = p.total_withdrawn
        .checked_sub(amount_tokens)
        .ok_or(ZephyonError::MathOverflow)?;
    let r = &mut ctx.accounts.receipt;
    r.user         = p.key();
    r.direction    = Receipt::DIR_WITHDRAW;
    r.asset_kind   = Receipt::ASSET_SPL;
    r.mint         = ctx.accounts.mint.key();
    r.amount       = amount_tokens;
    r.fee          = 0;
    r.pre_balance  = pre_balance;
    r.post_balance = p.total_withdrawn;
    r.ts           = now;
    r.tx_count     = p.tx_count;
    r.bump         = ctx.bumps.receipt;
    r.v2           = ReceiptV2Ext::spl(ctx.accounts.mint.key());

    emit!(crate::state::receipt::ReceiptCreated {
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

    p.tx_count = p.tx_count.saturating_add(1);
    Ok(())
}


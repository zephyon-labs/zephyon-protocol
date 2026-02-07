use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::errors::ErrorCode;
use crate::state::{Receipt, ReceiptV2Ext, Treasury};
use crate::events::SplPayEvent;
use crate::events::{AssetKind, PayDirection};


const MEMO_MAX: usize = 64;

#[derive(Accounts)]
#[instruction(amount: u64, reference: Option<[u8; 32]>, memo: Option<Vec<u8>>)]

pub struct SplPay<'info> {
    /// Treasury authority allowed to initiate payments
    #[account(mut)]
    pub treasury_authority: Signer<'info>,

    /// Recipient wallet receiving the tokens (does not need to sign)
    /// CHECK: constrained via recipient_ata below
    pub recipient: UncheckedAccount<'info>,

    /// Treasury PDA
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump,
        constraint = !treasury.paused @ ErrorCode::ProtocolPaused
    )]
    pub treasury: Account<'info, Treasury>,

    /// SPL mint being paid out
    pub mint: Account<'info, Mint>,

    /// Recipient ATA for this mint (create if missing; paid by treasury_authority)
    #[account(
        init_if_needed,
        payer = treasury_authority,
        associated_token::mint = mint,
        associated_token::authority = recipient
    )]
    pub recipient_ata: Account<'info, TokenAccount>,

    /// Treasury ATA for this mint
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = treasury
    )]
    pub treasury_ata: Account<'info, TokenAccount>,

    /// Payment receipt (treasury-namespaced, monotonic)
    #[account(
        init,
        payer = treasury_authority,
        space = 8 + Receipt::LEN,
        seeds = [
            b"receipt",
            treasury.key().as_ref(),
            &treasury.pay_count.to_le_bytes()
        ],
        bump
    )]
    pub receipt: Account<'info, Receipt>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<SplPay>,
    amount: u64,
    reference: Option<[u8; 32]>,
    memo: Option<Vec<u8>>,
) -> Result<()> {

    require!(amount > 0, ErrorCode::InvalidAmount);
    require!(!ctx.accounts.treasury.paused, ErrorCode::ProtocolPaused);
    if let Some(ref m) = memo {
        require!(m.len() <= MEMO_MAX, ErrorCode::MemoTooLong);
    }


    // Authority gate
    require_keys_eq!(
        ctx.accounts.treasury_authority.key(),
        ctx.accounts.treasury.authority,
        ErrorCode::UnauthorizedWithdraw
    );

    // Treasury PDA signs transfer out
    let bump = ctx.accounts.treasury.bump;
    let seeds: &[&[u8]] = &[b"treasury", &[bump]];
    let signer = &[seeds];

    let cpi_accounts = Transfer {
        from: ctx.accounts.treasury_ata.to_account_info(),
        to: ctx.accounts.recipient_ata.to_account_info(),
        authority: ctx.accounts.treasury.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer,
    );

    token::transfer(cpi_ctx, amount)?;

    // Receipt write (DIR_PAY)
    let pay_count_before = ctx.accounts.treasury.pay_count;
    let r = &mut ctx.accounts.receipt;

    r.user = ctx.accounts.recipient.key(); // "counterparty" for pay
    r.direction = Receipt::DIR_PAY;        // you’ll add this constant
    r.asset_kind = Receipt::ASSET_SPL;
    r.mint = ctx.accounts.mint.key();
    r.amount = amount;
    r.fee = 0;
    r.pre_balance = 0;
    r.post_balance = 0;
    r.ts = Clock::get()?.unix_timestamp;
    r.tx_count = pay_count_before; // use tx_count field as "payment index"
    r.bump = ctx.bumps.receipt;
    let memo_slice = memo.as_deref(); // Option<&[u8]>
    r.v2 = ReceiptV2Ext::spl_with_meta(ctx.accounts.mint.key(), reference, memo_slice);


   // Increment pay_count after
ctx.accounts.treasury.pay_count = ctx.accounts.treasury.pay_count.saturating_add(1);

// Emit event (after receipt/state succeeds)
let clock = Clock::get()?;

let (has_reference, reference_bytes) = match reference {
    Some(r) => (true, r),
    None => (false, [0u8; 32]),
};

let (has_memo, memo_len) = match memo.as_ref() {
    Some(m) => (true, m.len() as u8),
    None => (false, 0),
};

emit!(SplPayEvent {
    pay_count: pay_count_before,

    treasury: ctx.accounts.treasury.key(),
    treasury_authority: ctx.accounts.treasury_authority.key(),
    recipient: ctx.accounts.recipient.key(),

    receipt: ctx.accounts.receipt.key(),

    direction: PayDirection::TreasuryToRecipient,
    asset_kind: AssetKind::SPL,


    mint: ctx.accounts.mint.key(),
    amount,

    has_reference,
    reference: reference_bytes,

    has_memo,
    memo_len,
    slot: clock.slot,

    unix_timestamp: clock.unix_timestamp,
});


    Ok(())
}


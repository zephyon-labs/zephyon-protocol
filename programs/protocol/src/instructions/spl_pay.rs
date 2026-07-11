use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::errors::ErrorCode;
use crate::events::{AssetKind, PayDirection, SplPayEvent};
use crate::state::{Receipt, ReceiptV2Ext, Treasury};

const MEMO_MAX: usize = 64;

/// Treasury-funded SPL payout.
///
/// Current receipt mode:
/// - SPL pay receipts are pay_count-based
/// - receipt PDA seeds:
///   ["receipt", treasury.key(), treasury.pay_count_before.to_le_bytes()]
///
/// Important:
/// - This makes SPL pay a single-writer logical path for deterministic receipt creation
/// - concurrent pay attempts that read the same pay_count will target the same receipt PDA
/// - tests must model this explicitly and verify safe failure under contention
#[derive(Accounts)]
#[instruction(amount: u64, reference: Option<[u8; 32]>, memo: Option<Vec<u8>>)]
pub struct SplPay<'info> {
    /// Authority allowed to initiate treasury payouts
    #[account(mut)]
    pub treasury_authority: Signer<'info>,

    /// Recipient wallet receiving the tokens
    ///
    /// CHECK:
    /// This account is constrained indirectly through `recipient_ata`,
    /// which must be the associated token account for `(recipient, mint)`.
    pub recipient: UncheckedAccount<'info>,

    /// Canonical treasury PDA
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump,
        constraint = !treasury.paused @ ErrorCode::ProtocolPaused
    )]
    pub treasury: Account<'info, Treasury>,

    /// SPL mint being paid out
    pub mint: Account<'info, Mint>,

    /// Recipient ATA for this mint
    ///
    /// Created if missing, paid by treasury_authority.
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

    /// Payment receipt PDA
    ///
    /// Current canonical SPL pay receipt derivation:
    /// ["receipt", treasury.key(), treasury.pay_count_before.to_le_bytes()]
    #[account(
        init,
        payer = treasury_authority,
        space = Receipt::SPACE,
        seeds = [
            Receipt::RECEIPT_SEED,
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
    let treasury = &mut ctx.accounts.treasury;
    let treasury_authority = &ctx.accounts.treasury_authority;
    let recipient = &ctx.accounts.recipient;
    let mint = &ctx.accounts.mint;
    let receipt = &mut ctx.accounts.receipt;

    // --- Basic validation ---
    require!(amount > 0, ErrorCode::InvalidAmount);
    require!(!treasury.paused, ErrorCode::ProtocolPaused);

    if let Some(ref m) = memo {
        require!(m.len() <= MEMO_MAX, ErrorCode::MemoTooLong);
    }

    // --- Authority gate ---
    require_keys_eq!(
        treasury_authority.key(),
        treasury.authority,
        ErrorCode::UnauthorizedWithdraw
    );

    // Capture the canonical pay index BEFORE mutation.
    // This value is used for:
    // - receipt PDA derivation
    // - receipt.tx_count storage (flow-specific payment index)
    // - emitted event indexing
    let pay_count_before = treasury.pay_count;

    // --- Treasury PDA signer seeds for token transfer ---
    let bump = treasury.bump;
    let signer_seeds: &[&[u8]] = &[b"treasury", &[bump]];
    let signer = &[signer_seeds];

    // --- Transfer treasury funds to recipient ATA ---
    //
    // Note:
    // This occurs before receipt field population, but the instruction remains atomic.
    // Any later failure in this instruction rolls back the transfer as well.
    let cpi_accounts = Transfer {
        from: ctx.accounts.treasury_ata.to_account_info(),
        to: ctx.accounts.recipient_ata.to_account_info(),
        authority: treasury.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer,
    );

    token::transfer(cpi_ctx, amount)?;

    // --- Populate receipt ---
    //
    // For pay flows:
    // - `user` stores the recipient wallet
    // - `tx_count` stores the treasury pay_count snapshot BEFORE increment
    receipt.user = recipient.key();
    receipt.direction = Receipt::DIR_PAY;
    receipt.asset_kind = Receipt::ASSET_SPL;
    receipt.mint = mint.key();
    receipt.amount = amount;
    receipt.fee = 0;
    receipt.pre_balance = 0;
    receipt.post_balance = 0;
    receipt.ts = Clock::get()?.unix_timestamp;
    receipt.tx_count = pay_count_before;
    receipt.bump = ctx.bumps.receipt;

    let memo_slice = memo.as_deref();
    receipt.v2 = ReceiptV2Ext::spl_with_meta(mint.key(), reference, memo_slice);

    // --- Increment pay_count (must fail loudly on overflow) ---
    treasury.pay_count = treasury
        .pay_count
        .checked_add(1)
        .ok_or(ErrorCode::CounterOverflow)?;

    // --- Emit event after successful transfer + receipt + counter mutation ---
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
        treasury: treasury.key(),
        treasury_authority: treasury_authority.key(),
        recipient: recipient.key(),
        receipt: receipt.key(),
        direction: PayDirection::TreasuryToRecipient,
        asset_kind: AssetKind::SPL,
        mint: mint.key(),
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


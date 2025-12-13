#![allow(clippy::result_large_err)]

extern crate self as __client_accounts_protocol;
extern crate self as __client_accounts_spl_deposit;
extern crate self as __client_accounts_spl_withdraw;

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

pub mod state;
pub mod instructions;
pub mod utils;

// Receipt types used in events / state
use crate::state::receipt::{Receipt, ReceiptV2Ext, ReceiptCreated};

// Pull in instruction contexts + handlers (SPL)
use crate::instructions::{
    SplDeposit, SplWithdraw,
    spl_deposit_handler, spl_withdraw_handler,
};

// ID + constants
declare_id!("DsXi8h54n4Ma3c3wjwg5caESLvic33RLbfjTC1Y1Aqk1");
pub const PROTOCOL_AUTHORITY: Pubkey =
    pubkey!("Hx2vTD7PrqH6nUEvP8AYo9qcsAfS9NpPcnqc2HJWmFcc");

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────
#[error_code]
pub enum ZephyonError {
    #[msg("Unauthorized treasury initialization")]
    UnauthorizedTreasuryInit,
    #[msg("Treasury already initialized")]
    TreasuryAlreadyInitialized,
    #[msg("Invalid PDA for treasury")]
    InvalidTreasuryPda,
    #[msg("Math overflow detected")]
    MathOverflow,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Unauthorized user")]
    Unauthorized,
}

// =======================
// Core State - On-Chain
// =======================
#[account]
pub struct Treasury {
    pub authority: Pubkey,
    pub total_deposited: u64,
    pub bump: u8,
}
impl Treasury {
    pub const LEN: usize = 32 + 8 + 1;
}

#[account]
pub struct ProtocolState {
    pub protocol_authority: Pubkey,
    pub treasury: Pubkey,
    pub bump: u8,
}
impl ProtocolState {
    pub const LEN: usize = 32 + 32 + 1;
}

#[account]
pub struct UserProfile {
    pub authority: Pubkey,
    pub joined_at: i64,
    pub tx_count: u64,
    pub total_sent: u64,
    pub total_received: u64,
    pub risk_score: u8,
    pub flags: u8,
    pub bump: u8,
    // deposit tracking
    pub deposit_count: u64,
    pub total_deposited: u64,
    pub last_deposit_at: i64,
    // withdraw tracking
    pub withdraw_count: u64,
    pub total_withdrawn: u64,
    pub last_withdraw_at: i64,
}
impl UserProfile {
    pub const LEN: usize =
        32 + 8 + 8 + 8 + 8 + 1 + 1 + 1 + 8 + 8 + 8 + 8 + 8 + 8;
}

// =======================
// Legacy Events (Core09/10)
// =======================
#[event]
pub struct DepositMade {
    pub user: Pubkey,
    pub amount: u64,
    pub new_deposit_count: u64,
    pub new_total_deposited: u64,
    pub ts: i64,
}

#[event]
pub struct WithdrawalMade {
    pub user: Pubkey,
    pub amount: u64,
    pub new_tx_count: u64,
    pub ts: i64,
}

// =======================
// Accounts Contexts
// =======================
#[derive(Accounts)]
pub struct Initialize {}

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    #[account(
        init,
        seeds = [b"zephyon_treasury"],
        bump,
        payer = authority,
        space = 8 + Treasury::LEN
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(
        mut,
        address = PROTOCOL_AUTHORITY @ ZephyonError::UnauthorizedTreasuryInit
    )]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(
        init,
        seeds = [b"protocol_state"],
        bump,
        payer = authority,
        space = 8 + ProtocolState::LEN
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"zephyon_treasury"],
        bump = treasury.bump
    )]
    pub treasury: Account<'info, Treasury>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterUser<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + UserProfile::LEN,
        seeds = [
            b"user_profile",
            protocol_state.key().as_ref(),
            authority.key().as_ref()
        ],
        bump
    )]
    pub user_profile: Account<'info, UserProfile>,

    #[account(seeds = [b"protocol_state"], bump = protocol_state.bump)]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(seeds = [b"zephyon_treasury"], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(has_one = treasury @ ZephyonError::InvalidTreasuryPda)]
    pub protocol_state: Account<'info, ProtocolState>,

    /// CHECK: lamport-only PDA — enforce seeds so it’s the real treasury
    #[account(
        mut,
        seeds = [b"zephyon_treasury"],
        bump
    )]
    pub treasury: AccountInfo<'info>,

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

    // TEMP: oversize to eliminate deserialize errors; we’ll switch back to Receipt::SPACE
    #[account(
        init,
        payer = user,
        space = 8 + 256,
        seeds = [
            b"receipt",
            user_profile.key().as_ref(),
            &user_profile.tx_count.to_le_bytes()
        ],
        bump
    )]
    pub receipt: Account<'info, Receipt>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(has_one = treasury @ ZephyonError::InvalidTreasuryPda)]
    pub protocol_state: Account<'info, ProtocolState>,

    /// CHECK: lamport-only PDA — enforce seeds
    #[account(
        mut,
        seeds = [b"zephyon_treasury"],
        bump
    )]
    pub treasury: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"user_profile", protocol_state.key().as_ref(), user.key().as_ref()],
        bump = user_profile.bump,
        constraint = user_profile.authority == user.key() @ ZephyonError::Unauthorized
    )]
    pub user_profile: Account<'info, UserProfile>,

    // TEMP oversize; same rationale as Deposit
    #[account(
        init,
        payer = user,
        space = 8 + 256,
        seeds = [
            b"receipt",
            user_profile.key().as_ref(),
            &user_profile.tx_count.to_le_bytes()
        ],
        bump
    )]
    pub receipt: Account<'info, Receipt>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// =======================
// Program Instructions
// =======================
#[program]
pub mod protocol {
    use super::*;

    // ───── Core12 SPL entrypoints ─────
    pub fn spl_deposit(ctx: Context<SplDeposit>, amount_tokens: u64) -> Result<()> {
        spl_deposit_handler(ctx, amount_tokens)
    }

    pub fn spl_withdraw(ctx: Context<SplWithdraw>, amount_tokens: u64) -> Result<()> {
        spl_withdraw_handler(ctx, amount_tokens)
    }

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {}", crate::ID);
        Ok(())
    }

    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        let treasury = &mut ctx.accounts.treasury;
        treasury.authority = ctx.accounts.authority.key();
        treasury.total_deposited = 0;
        treasury.bump = ctx.bumps.treasury;
        Ok(())
    }

    pub fn initialize_protocol(ctx: Context<InitializeProtocol>) -> Result<()> {
        let protocol_state = &mut ctx.accounts.protocol_state;
        protocol_state.protocol_authority = ctx.accounts.authority.key();
        protocol_state.treasury = ctx.accounts.treasury.key();
        protocol_state.bump = ctx.bumps.protocol_state;
        Ok(())
    }

    pub fn register_user(ctx: Context<RegisterUser>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.protocol_state.treasury,
            ctx.accounts.treasury.key(),
            ZephyonError::InvalidTreasuryPda
        );

        let p = &mut ctx.accounts.user_profile;
        let now = Clock::get()?.unix_timestamp;

        p.authority = ctx.accounts.authority.key();
        p.joined_at = now;
        p.tx_count = 0;
        p.total_sent = 0;
        p.total_received = 0;
        p.risk_score = 0;
        p.flags = 0;
        p.bump = ctx.bumps.user_profile;

        p.deposit_count = 0;
        p.total_deposited = 0;
        p.last_deposit_at = 0;

        p.withdraw_count = 0;
        p.total_withdrawn = 0;
        p.last_withdraw_at = 0;

        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, ZephyonError::InsufficientFunds);

        if ctx.accounts.user_profile.authority != ctx.accounts.user.key() {
            return err!(ZephyonError::Unauthorized);
        }

        // 1) Move SOL user -> treasury
        let ix = Transfer {
            from: ctx.accounts.user.to_account_info(),
            to:   ctx.accounts.treasury.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), ix);
        system_program::transfer(cpi_ctx, amount)?;

        // 2) Update counters
        let profile = &mut ctx.accounts.user_profile;
        profile.deposit_count = profile.deposit_count.checked_add(1).ok_or(ZephyonError::MathOverflow)?;
        profile.total_deposited = profile.total_deposited.checked_add(amount).ok_or(ZephyonError::MathOverflow)?;
        profile.last_deposit_at = Clock::get()?.unix_timestamp;

        // 3) Legacy event
        emit!(DepositMade {
            user: ctx.accounts.user.key(),
            amount,
            new_deposit_count: profile.deposit_count,
            new_total_deposited: profile.total_deposited,
            ts: profile.last_deposit_at,
        });

        // 4) Receipt snapshot (pre-increment)
        let tx_snapshot = profile.tx_count;
        let ts = profile.last_deposit_at;
        let post_balance = profile.total_deposited;
        let pre_balance  = post_balance.checked_sub(amount).ok_or(ZephyonError::MathOverflow)?;

        let r = &mut ctx.accounts.receipt;
        r.user         = profile.key();
        r.direction    = Receipt::DIR_DEPOSIT;
        r.asset_kind   = Receipt::ASSET_SOL;
        r.mint         = Pubkey::default(); // SOL
        r.amount       = amount;
        r.fee          = 0;
        r.pre_balance  = pre_balance;
        r.post_balance = post_balance;
        r.ts           = ts;
        r.tx_count     = tx_snapshot;
        r.bump         = ctx.bumps.receipt;
        r.v2           = ReceiptV2Ext::sol();

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

        // 5) Increment AFTER creating receipt
        profile.tx_count = profile.tx_count.saturating_add(1);
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, ZephyonError::InsufficientFunds);
        require_keys_eq!(
            ctx.accounts.protocol_state.treasury,
            ctx.accounts.treasury.key(),
            ZephyonError::InvalidTreasuryPda
        );
        require!(ctx.accounts.treasury.lamports() >= amount, ZephyonError::InsufficientFunds);

        // PDA lamports transfer: treasury -> user
        let from = &mut ctx.accounts.treasury;
        let to = &mut ctx.accounts.user.to_account_info();
        **from.try_borrow_mut_lamports()? -= amount;
        **to.try_borrow_mut_lamports()?   += amount;

        let p = &mut ctx.accounts.user_profile;
        let now = Clock::get()?.unix_timestamp;
        p.withdraw_count = p.withdraw_count.saturating_add(1);
        p.total_withdrawn = p.total_withdrawn.checked_add(amount).ok_or(ZephyonError::MathOverflow)?;
        p.last_withdraw_at = now;

        let pre_balance = p.total_withdrawn.checked_sub(amount).ok_or(ZephyonError::MathOverflow)?;
        let post_balance = p.total_withdrawn;

        let r = &mut ctx.accounts.receipt;
        r.user         = p.key();
        r.direction    = Receipt::DIR_WITHDRAW;
        r.asset_kind   = Receipt::ASSET_SOL;
        r.mint         = Pubkey::default();
        r.amount       = amount;
        r.fee          = 0;
        r.pre_balance  = pre_balance;
        r.post_balance = post_balance;
        r.ts           = now;
        r.tx_count     = p.tx_count;
        r.bump         = ctx.bumps.receipt;
        r.v2           = ReceiptV2Ext::sol();

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

        p.tx_count = p.tx_count.saturating_add(1);
        Ok(())
    }
}





 
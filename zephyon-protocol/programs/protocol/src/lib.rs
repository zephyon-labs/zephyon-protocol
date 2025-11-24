use anchor_lang::prelude::*;
use anchor_lang::prelude::pubkey;
use anchor_lang::system_program::{self, Transfer};

declare_id!("3NCZzyVQXxEs8ncAVS1fwm5t25Vnhkzctfb7XkEnyDtD");

// This must be YOUR authority wallet (the one you control).
// Run `solana address` and paste it here if it changes.
pub const PROTOCOL_AUTHORITY: Pubkey = pubkey!("DWLaEPUUyLgPqhoJDGni8PRaL58FdfSmXdL6Qtrp1hJ8");

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
    /// Protocol authority (who can move pooled funds)
    pub authority: Pubkey,
    /// Total lamports deposited into this treasury
    pub total_deposited: u64,
    /// Bump seed for this Treasury PDA
    pub bump: u8,
}
impl Treasury {
    // 32 (authority) + 8 (total_deposited) + 1 (bump)
    pub const LEN: usize = 32 + 8 + 1;
}

#[account]
pub struct ProtocolState {
    /// PDA that acts as the protocol's logical authority
    pub protocol_authority: Pubkey,
    /// Treasury PDA address this protocol instance uses
    pub treasury: Pubkey,
    /// Bump seed for this ProtocolState PDA
    pub bump: u8,
}
impl ProtocolState {
    // 32 (protocol_authority) + 32 (treasury) + 1 (bump)
    pub const LEN: usize = 32 + 32 + 1;
}

#[account]
pub struct UserProfile {
    /// Owner of this profile (wallet that registered)
    pub authority: Pubkey,
    /// When this profile was created (unix timestamp)
    pub joined_at: i64,
    /// Total number of transactions this user has performed
    pub tx_count: u64,
    /// Total lamports (or smallest unit) sent by this user
    pub total_sent: u64,
    /// Total lamports received by this user
    pub total_received: u64,
    /// Simple 0–100 risk indicator for NovaGuard
    pub risk_score: u8,
    /// Bitflags for things like is_merchant, is_frozen, high_risk, etc.
    pub flags: u8,
    /// PDA bump
    pub bump: u8,
    /// Core09 deposits
    pub deposit_count: u64,
    pub total_deposited: u64,
    pub last_deposit_at: i64,
    /// Core10 withdrawals
    pub withdraw_count: u64,
    pub total_withdrawn: u64,
    pub last_withdraw_at: i64,
}
impl UserProfile {
    // = 115 bytes (plus 8 discriminator in account space calc)
    pub const LEN: usize =
        32 + 8 + 8 + 8 + 8 + 1 + 1 + 1 + 8 + 8 + 8 + 8 + 8 + 8;
}

// =======================
// Core11 — Receipt Ledger
// =======================

#[account]
pub struct Receipt {
    pub user: Pubkey,       // 32  (PDA of the UserProfile)
    pub direction: u8,      // 0 = deposit, 1 = withdraw
    pub asset_kind: u8,     // 0 = SOL, 1 = SPL
    pub mint: Pubkey,       // 32  (default for SOL)
    pub amount: u64,        // 8
    pub fee: u64,           // 8   (reserved)
    pub pre_balance: u64,   // 8   (path-specific proxy)
    pub post_balance: u64,  // 8
    pub ts: i64,            // 8
    pub tx_count: u64,      // 8   (snapshot used in seeds)
    pub bump: u8,           // 1
}
impl Receipt {
    pub const SPACE: usize = 8
        + 32 + 1 + 1 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 1;

    pub const DIR_DEPOSIT: u8 = 0;
    pub const DIR_WITHDRAW: u8 = 1;

    pub const ASSET_SOL: u8 = 0;
    pub const ASSET_SPL: u8 = 1;
}

#[event]
pub struct ReceiptCreated {
    pub user: Pubkey,
    pub direction: u8,
    pub asset_kind: u8,
    pub mint: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub pre_balance: u64,
    pub post_balance: u64,
    pub ts: i64,
    pub tx_count: u64,
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

    // Only the fixed protocol authority may initialize the treasury.
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

    #[account(
        seeds = [b"protocol_state"],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(
        seeds = [b"zephyon_treasury"],
        bump = treasury.bump
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    // Protocol must point to the correct treasury (Core08 guardrail)
    #[account(has_one = treasury @ ZephyonError::InvalidTreasuryPda)]
    pub protocol_state: Account<'info, ProtocolState>,

    /// CHECK: treasury is lamport-only PDA
    #[account(mut)]
    pub treasury: AccountInfo<'info>,

    // User profile PDA belonging to signer — same seeds as RegisterUser
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

    /// Core11: init immutable receipt at snapshot(user_profile.tx_count)
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

    /// User paying the deposit
    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    // Guardrail: ProtocolState must be bound to the same treasury PDA
    #[account(has_one = treasury @ ZephyonError::InvalidTreasuryPda)]
    pub protocol_state: Account<'info, ProtocolState>,

    // Treasury PDA (lamport-only), used as source of funds
    #[account(
        mut,
        seeds = [b"zephyon_treasury"],
        bump
    )]
    /// CHECK: lamport-only PDA; seeds + has_one protect it
    pub treasury: AccountInfo<'info>,

    // Caller’s user profile (same seeds as RegisterUser)
    #[account(
        mut,
        seeds = [b"user_profile", protocol_state.key().as_ref(), user.key().as_ref()],
        bump = user_profile.bump,
        constraint = user_profile.authority == user.key() @ ZephyonError::Unauthorized
    )]
    pub user_profile: Account<'info, UserProfile>,

    /// Core11: init immutable receipt at snapshot(user_profile.tx_count)
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

    /// Withdrawal recipient & signer
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

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {}", crate::ID);
        Ok(())
    }

    /// Create the Treasury PDA and set its authority.
    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        let treasury = &mut ctx.accounts.treasury;
        treasury.authority = ctx.accounts.authority.key();
        treasury.total_deposited = 0;
        treasury.bump = ctx.bumps.treasury;
        Ok(())
    }

    /// Create the ProtocolState PDA and link it to the Treasury.
    pub fn initialize_protocol(ctx: Context<InitializeProtocol>) -> Result<()> {
        let protocol_state = &mut ctx.accounts.protocol_state;
        protocol_state.protocol_authority = ctx.accounts.authority.key();
        protocol_state.treasury = ctx.accounts.treasury.key();
        protocol_state.bump = ctx.bumps.protocol_state;
        Ok(())
    }

    /// Register a new user by creating their namespaced UserProfile PDA.
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

    /// Core09 — deposit SOL to the protocol treasury and update counters (with Core11 receipt).
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, ZephyonError::InsufficientFunds);

        // Make Unauthorized reason explicit for test matching (redundant with constraint, intentional)
        if ctx.accounts.user_profile.authority != ctx.accounts.user.key() {
            msg!("Unauthorized");
            return err!(ZephyonError::Unauthorized);
        }

        // 1) Transfer SOL from user → treasury
        let ix = Transfer {
            from: ctx.accounts.user.to_account_info(),
            to:   ctx.accounts.treasury.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), ix);
        system_program::transfer(cpi_ctx, amount)?;

        // 2) Update counters
        let profile = &mut ctx.accounts.user_profile;
        profile.deposit_count = profile.deposit_count
            .checked_add(1).ok_or(ZephyonError::MathOverflow)?;
        profile.total_deposited = profile.total_deposited
            .checked_add(amount).ok_or(ZephyonError::MathOverflow)?;
        profile.last_deposit_at = Clock::get()?.unix_timestamp;

        // 3) Emit legacy event
        emit!(DepositMade {
            user: ctx.accounts.user.key(),
            amount,
            new_deposit_count: profile.deposit_count,
            new_total_deposited: profile.total_deposited,
            ts: profile.last_deposit_at,
        });

        // 4) Core11 receipt (snapshot BEFORE incrementing tx_count)
        let tx_snapshot = profile.tx_count;
        let ts = profile.last_deposit_at;

        let post_balance = profile.total_deposited;
        let pre_balance  = post_balance.checked_sub(amount).ok_or(ZephyonError::MathOverflow)?;

        let r = &mut ctx.accounts.receipt;
        r.user         = profile.key();
        r.direction    = Receipt::DIR_DEPOSIT;
        r.asset_kind   = Receipt::ASSET_SOL;
        r.mint         = Pubkey::default();
        r.amount       = amount;
        r.fee          = 0;
        r.pre_balance  = pre_balance;
        r.post_balance = post_balance;
        r.ts           = ts;
        r.tx_count     = tx_snapshot;
        r.bump         = ctx.bumps.receipt;

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

        // 5) Increment AFTER receipt creation to keep ordering correct
        profile.tx_count = profile.tx_count.saturating_add(1);

        Ok(())
    }

    /// Core10 — withdraw SOL from the treasury to the user; update counters (with Core11 receipt).
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, ZephyonError::InsufficientFunds);

        require_keys_eq!(
            ctx.accounts.protocol_state.treasury,
            ctx.accounts.treasury.key(),
            ZephyonError::InvalidTreasuryPda
        );

        // Ensure treasury has funds
        require!(
            ctx.accounts.treasury.lamports() >= amount,
            ZephyonError::InsufficientFunds
        );

        // PDA-signed direct lamports transfer: treasury -> user
        let from = &mut ctx.accounts.treasury;
        let to = &mut ctx.accounts.user.to_account_info();
        **from.try_borrow_mut_lamports()? -= amount;
        **to.try_borrow_mut_lamports()?   += amount;

        // Update counters
        let p = &mut ctx.accounts.user_profile;
        let now = Clock::get()?.unix_timestamp;
        p.withdraw_count = p.withdraw_count.saturating_add(1);
        p.total_withdrawn = p.total_withdrawn
            .checked_add(amount).ok_or(ZephyonError::MathOverflow)?;
        p.last_withdraw_at = now;

        // Emit legacy event
        // (increment AFTER receipt to mirror deposit ordering)
        let tx_snapshot = p.tx_count;

        // Core11 receipt for withdraw — use totals as the path proxy
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
        r.tx_count     = tx_snapshot;
        r.bump         = ctx.bumps.receipt;

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
        // Reimburse user for rent paid to create the receipt account
// reimburse user for rent
let rent = Rent::get()?;
let rent_lamports: u64 = rent.minimum_balance(Receipt::SPACE);

let from = &mut ctx.accounts.treasury;
    let to   = &mut ctx.accounts.user.to_account_info();

require!(
    from2.lamports() >= rent_lamports,
    ZephyonError::InsufficientFunds
);

// ACTUAL lamport transfer
**from2.try_borrow_mut_lamports()? -= rent_lamports;
**to2.try_borrow_mut_lamports()? += rent_lamports;


        // Now increment and emit legacy
        p.tx_count = p.tx_count.saturating_add(1);
        emit!(WithdrawalMade {
            user: ctx.accounts.user.key(),
            amount,
            new_tx_count: p.tx_count,
            ts: now,
        });

        Ok(())
    }
}

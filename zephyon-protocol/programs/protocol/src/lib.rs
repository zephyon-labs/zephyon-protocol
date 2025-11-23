use anchor_lang::prelude::*;
use anchor_lang::prelude::pubkey;

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
}

impl UserProfile {
    // 32 (authority)
    // + 8 (joined_at)
    // + 8 (tx_count)
    // + 8 (total_sent)
    // + 8 (total_received)
    // + 1 (risk_score)
    // + 1 (flags)
    // + 1 (bump)
    pub const LEN: usize = 32 + 8 + 8 + 8 + 8 + 1 + 1 + 1;
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

        // Set the authority that controls this treasury.
        treasury.authority = ctx.accounts.authority.key();
        // Start accounting at zero.
        treasury.total_deposited = 0;
        // Store the bump for this PDA.
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
    // TODO(core09): add `Deposit` context + `deposit(amount: u64)` handler here (SOL transfer + counters + event)

    /// Register a new user in the Zephyon Protocol by creating their PDA account.
    pub fn register_user(ctx: Context<RegisterUser>) -> Result<()> {
        // Guardrail: protocol_state must point to this treasury
    require_keys_eq!(
        ctx.accounts.protocol_state.treasury,
        ctx.accounts.treasury.key(),
        ZephyonError::InvalidTreasuryPda
    );

    let user_profile = &mut ctx.accounts.user_profile;
    let authority = &ctx.accounts.authority;

    let clock = Clock::get()?;

    user_profile.authority = authority.key();
    user_profile.joined_at = clock.unix_timestamp;
    user_profile.tx_count = 0;
    user_profile.total_sent = 0;
    user_profile.total_received = 0;
    user_profile.risk_score = 0;
    user_profile.flags = 0;
    user_profile.bump = ctx.bumps.user_profile;

    Ok(())
}

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
    // New ProtocolState PDA for this protocol instance
    #[account(
        init,
        seeds = [b"protocol_state"],
        bump,
        payer = authority,
        space = 8 + ProtocolState::LEN
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    // The signer that funds + controls this protocol instance (for now)
    #[account(mut)]
    pub authority: Signer<'info>,

    // Existing Treasury account that this protocol instance will use
    #[account(mut)]
    pub treasury: Account<'info, Treasury>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterUser<'info> {

    /// PDA for the user's profile
    #[account(
        init,
        payer = authority,
        space = 8 + UserProfile::LEN,
        seeds = [b"user_profile", authority.key().as_ref()],
        bump,
    )]
    pub user_profile: Account<'info, UserProfile>,

    /// Read-only protocol state (must be the canonical PDA)
    #[account(
        seeds = [b"protocol_state"],
        bump = protocol_state.bump,
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    /// Read-only treasury (must be the canonical PDA)
    #[account(
        seeds = [b"zephyon_treasury"],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,

    /// The wallet registering as a Zephyon user
    #[account(mut)]
    pub authority: Signer<'info>,

    /// System program
    pub system_program: Program<'info, System>,
}









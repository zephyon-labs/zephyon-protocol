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
pub struct UserAccount {
    /// User wallet that controls this account
    pub authority: Pubkey,
    /// Total amount this user has deposited into Zephyon
    pub deposited_amount: u64,
    /// Bump seed for this UserAccount PDA
    pub bump: u8,
}

impl UserAccount {
    // 32 (authority) + 8 (deposited_amount) + 1 (bump)
    pub const LEN: usize = 32 + 8 + 1;
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

    /// Register a new user in the Zephyon Protocol by creating their PDA account.
    pub fn register_user(ctx: Context<RegisterUser>) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;

        // Store who owns this account
        user_account.authority = ctx.accounts.authority.key();

        // Start with zero balance
        user_account.deposited_amount = 0;

        // Store bump for PDA re-derivation
        user_account.bump = ctx.bumps.user_account;

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
    // PDA for the user's program-owned account
    #[account(
        init,
        seeds = [b"user", authority.key().as_ref()],
        bump,
        payer = authority,
        space = 8 + UserAccount::LEN
    )]
    pub user_account: Account<'info, UserAccount>,

    /// The wallet registering as a Zephyon user
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}




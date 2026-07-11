use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use crate::events::TreasuryPausedSetEvent;
use crate::state::treasury::Treasury;

/// Sets the global paused state for the protocol treasury.
///
/// When paused:
/// - value-moving instructions (pay, withdraw, etc.) must reject
/// - state remains unchanged except for this flag
///
/// Only the configured treasury authority may toggle this state.
///
/// This instruction is intentionally minimal and side-effect free
/// beyond updating the pause flag and emitting an event.
#[derive(Accounts)]
pub struct SetTreasuryPaused<'info> {
    /// Canonical treasury PDA
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump
    )]
    pub treasury: Account<'info, Treasury>,

    /// Authorized signer for treasury control
    pub treasury_authority: Signer<'info>,
}

pub fn handler(ctx: Context<SetTreasuryPaused>, paused: bool) -> Result<()> {
    let treasury = &mut ctx.accounts.treasury;
    let authority = &ctx.accounts.treasury_authority;

    // --- Authority gate ---
    require_keys_eq!(
        authority.key(),
        treasury.authority,
        ErrorCode::UnauthorizedWithdraw
    );

    // --- State mutation ---
    treasury.paused = paused;

    // --- Emit event after successful state change ---
    let clock = Clock::get()?;
    emit!(TreasuryPausedSetEvent {
        treasury: treasury.key(),
        authority: authority.key(),
        paused,
        slot: clock.slot,
        unix_timestamp: clock.unix_timestamp,
    });

    Ok(())
}

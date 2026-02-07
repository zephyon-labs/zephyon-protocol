use crate::events::TreasuryInitializedEvent;
use crate::state::treasury::Treasury;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        seeds = [b"treasury"],
        bump,
        space = Treasury::INIT_SPACE
    )]
    pub treasury: Account<'info, Treasury>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeTreasury>) -> Result<()> {
    let treasury = &mut ctx.accounts.treasury;

    treasury.authority = ctx.accounts.authority.key();
    treasury.paused = false;
    treasury.bump = ctx.bumps.treasury;
    treasury.pay_count = 0;

    // Core28: governance observability (non-behavioral)
    let clock = Clock::get()?;
    emit!(TreasuryInitializedEvent {
        treasury: treasury.key(),
        authority: ctx.accounts.authority.key(),
        paused: treasury.paused,
        bump: treasury.bump,
        pay_count: treasury.pay_count,
        slot: clock.slot,
        unix_timestamp: clock.unix_timestamp,
    });

    Ok(())
}


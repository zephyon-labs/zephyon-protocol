use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use crate::state::treasury::Treasury;

#[derive(Accounts)]
pub struct SetTreasuryPaused<'info> {
    #[account(mut)]
    pub treasury: Account<'info, Treasury>,

    pub treasury_authority: Signer<'info>,
}

pub fn handler(ctx: Context<SetTreasuryPaused>, paused: bool) -> Result<()> {
    msg!("SetTreasuryPaused invoked");
    msg!("Treasury PDA: {}", ctx.accounts.treasury.key());
    msg!(
        "Treasury stored authority: {}",
        ctx.accounts.treasury.authority
    );
    msg!(
        "Signer treasury_authority: {}",
        ctx.accounts.treasury_authority.key()
    );
    msg!("Requested paused -> {}", paused);

    require!(
        ctx.accounts.treasury.authority == ctx.accounts.treasury_authority.key(),
        ErrorCode::UnauthorizedWithdraw
    );

    ctx.accounts.treasury.paused = paused;

    msg!("Treasury paused is now: {}", ctx.accounts.treasury.paused);
    Ok(())
}

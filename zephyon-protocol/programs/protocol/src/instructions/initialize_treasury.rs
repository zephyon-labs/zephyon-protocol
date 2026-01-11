use anchor_lang::prelude::*;
use crate::state::treasury::Treasury;


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

    Ok(())
}







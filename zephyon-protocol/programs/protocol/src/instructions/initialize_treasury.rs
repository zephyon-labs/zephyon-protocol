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
        space = 8 + 32 + 1
    )]
    pub treasury: Account<'info, Treasury>,

    pub system_program: Program<'info, System>,
}


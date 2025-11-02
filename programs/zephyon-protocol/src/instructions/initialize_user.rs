use anchor_lang::prelude::*;
use crate::state::user_account::UserAccount;

#[derive(Accounts)]
pub struct InitializeUser<'info> {
    /// The wallet paying for account creation and becoming the owner.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The PDA that will store this user's data.
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<UserAccount>(),
        seeds = [b"user_account", payer.key().as_ref()],
        bump,
    )]
    pub user_account: Account<'info, UserAccount>,

    /// System program (required for creating accounts).
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeUser>) -> Result<()> {
    let user_account = &mut ctx.accounts.user_account;

    user_account.owner = ctx.accounts.payer.key();
    user_account.balance_lamports = 0;
    user_account.frozen = false;

    // ✅ FIXED bump extraction for current Anchor
    user_account.bump = ctx.bumps.user_account;

    user_account.version = 1;

    msg!("✅ UserAccount initialized for {:?}", user_account.owner);
    Ok(())
}


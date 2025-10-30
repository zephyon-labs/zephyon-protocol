use anchor_lang::prelude::*;

// Temporary placeholder Program ID.
// We will replace this with the real Program ID after first deploy.
declare_id!("4u849yEmC4oRkBE2HcMCTYxuZuazPiqueps7XkCk16qx");

#[program]
pub mod zephyon_protocol {
    use super::*;

    // Simple initializer. Stores a u64 in a fresh account.
    pub fn initialize(ctx: Context<Initialize>, data: u64) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.value = data;
        Ok(())
    }
}

// The accounts struct defines what accounts must be passed in to `initialize`.
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = signer,
        space = 8 + 8, // 8 bytes discriminator + 8 bytes for our u64
    )]
    pub state: Account<'info, ProtocolState>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// Persistent data for Zephyon's first piece of state.
// This is your protocol's first "memory cell" on-chain.
#[account]
pub struct ProtocolState {
    pub value: u64,
}



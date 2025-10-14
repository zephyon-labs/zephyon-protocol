use anchor_lang::prelude::*;

declare_id!("3NCZzyVQXxEs8ncAVS1fwm5t25Vnhkzctfb7XkEnyDtD");

#[program]
pub mod protocol {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}

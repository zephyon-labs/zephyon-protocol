use anchor_lang::prelude::*;

// Declare the program ID so Anchor knows which program this code belongs to.
// (Anchor.toml keeps this in sync automatically.)
declare_id!("4u849yEmC4oRkBE2HcMCTYxuZuazPiqueps7XkCk16qx");

pub mod state;
pub mod instructions;

use state::*;
use instructions::*;

// -----------------------------------------------------------------------------
// 🧩 Zephyon Protocol — Core04: Initialize User
// -----------------------------------------------------------------------------
#[program]
pub mod zephyon_protocol {
    use super::*;

    // Entry point for user initialization.
    pub fn initialize_user(ctx: Context<InitializeUser>) -> Result<()> {
        instructions::initialize_user::handler(ctx)
    }
}

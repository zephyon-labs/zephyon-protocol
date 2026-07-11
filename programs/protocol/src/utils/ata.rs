use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

/// Assert that an ATA belongs to the expected owner (signer/PDA).
pub fn assert_ata_owner(ata: &Account<TokenAccount>, owner: &Pubkey) -> Result<()> {
    require_keys_eq!(ata.owner, *owner, crate::ZephyonError::Unauthorized);
    Ok(())
}

/// Assert that an ATA is for the expected mint.
pub fn assert_ata_mint(ata: &Account<TokenAccount>, mint: &Pubkey) -> Result<()> {
    require_keys_eq!(ata.mint, *mint, crate::ZephyonError::Unauthorized);
    Ok(())
}


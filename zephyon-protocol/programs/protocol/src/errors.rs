use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Protocol is paused.")]
    ProtocolPaused,

    #[msg("Amount must be greater than 0.")]
    InvalidAmount,

    #[msg("Only the treasury authority may withdraw.")]
    UnauthorizedWithdraw,

    #[msg("Only the treasury authority may pause/unpause.")]
    UnauthorizedPause,

    #[msg("User profile authority does not match the signer.")]
    InvalidUserProfileAuthority,

    #[msg("User token account owner mismatch.")]
    InvalidUserTokenAccountOwner,

    #[msg("Treasury token account owner mismatch.")]
    InvalidTreasuryTokenAccountOwner,

    #[msg("Token mint mismatch.")]
    InvalidMint,

    #[msg("Insufficient funds.")]
    InsufficientFunds,
}

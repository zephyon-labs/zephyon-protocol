use anchor_lang::prelude::*;

/// Canonical on-chain receipt record.
///
/// Important:
/// - Receipt semantics are flow-specific.
/// - Different instructions may derive receipt PDAs differently.
/// - The stored `direction`, `asset_kind`, `mint`, and `tx_count` fields
///   are the durable source of truth for downstream indexing and audits.
///
/// Current direction values:
/// - 1 = deposit
/// - 2 = withdraw
/// - 3 = pay
///
/// Current asset kind values:
/// - 0 = unknown
/// - 1 = SOL
/// - 2 = SPL
#[account]
pub struct Receipt {
    /// Counterparty / user wallet associated with this receipt.
    ///
    /// Notes:
    /// - For deposit/withdraw flows, this is the user wallet involved.
    /// - For pay flows, this is the recipient wallet.
    pub user: Pubkey,

    /// Flow direction discriminator.
    pub direction: u8,

    /// Asset kind discriminator.
    pub asset_kind: u8,

    /// SPL mint for SPL flows, or Pubkey::default() for SOL flows.
    pub mint: Pubkey,

    /// Amount transferred.
    /// - SOL: lamports
    /// - SPL: raw token units
    pub amount: u64,

    /// Fee charged in the same unit as `amount`.
    /// Zero when unused.
    pub fee: u64,

    /// User-side balance snapshot before the operation.
    /// Zero when not captured by the flow.
    pub pre_balance: u64,

    /// User-side balance snapshot after the operation.
    /// Zero when not captured by the flow.
    pub post_balance: u64,

    /// Unix timestamp at receipt creation.
    pub ts: i64,

    /// Canonical per-flow index snapshot captured when this receipt was created.
    ///
    /// Notes:
    /// - This is not universally "user_profile.tx_count".
    /// - For current SPL pay flows, this stores `treasury.pay_count` BEFORE increment.
    /// - Other flows may use different indexing semantics.
    pub tx_count: u64,

    /// PDA bump.
    pub bump: u8,

    /// Fixed-size extension payload for future-proof metadata.
    pub v2: ReceiptV2Ext,
}

impl Receipt {
    pub const DIR_DEPOSIT: u8 = 1;
    pub const DIR_WITHDRAW: u8 = 2;
    pub const DIR_PAY: u8 = 3;

    pub const ASSET_UNKNOWN: u8 = 0;
    pub const ASSET_SOL: u8 = 1;
    pub const ASSET_SPL: u8 = 2;

    /// Shared receipt seed prefix.
    ///
    /// Warning:
    /// This is only the common seed prefix. The full PDA seed set is
    /// instruction-family specific and must match each instruction's live
    /// on-chain derivation exactly.
    pub const RECEIPT_SEED: &[u8] = b"receipt";

    /// Historical / generalized V2-style receipt seed helper.
    ///
    /// This helper is useful for flows that intentionally derive receipts from:
    /// - treasury
    /// - user
    /// - mint
    /// - tx_count bytes
    /// - direction byte
    ///
    /// It is NOT the universal live derivation for every current flow.
    /// In particular, current SPL pay receipts are treasury/pay_count-based.
    pub fn receipt_seeds_v2<'a>(
        treasury: &'a Pubkey,
        user: &'a Pubkey,
        mint: &'a Pubkey,
        tx_count: &'a [u8; 8],
        direction_seed: &'a [u8; 1],
    ) -> [&'a [u8]; 6] {
        [
            Self::RECEIPT_SEED,
            treasury.as_ref(),
            user.as_ref(),
            mint.as_ref(),
            tx_count.as_ref(),
            direction_seed.as_ref(),
        ]
    }

    /// Account data length excluding Anchor's 8-byte discriminator.
    pub const LEN: usize =
        32 + // user
        1 +  // direction
        1 +  // asset_kind
        32 + // mint
        8 +  // amount
        8 +  // fee
        8 +  // pre_balance
        8 +  // post_balance
        8 +  // ts
        8 +  // tx_count
        1 +  // bump
        ReceiptV2Ext::LEN;

    /// Full Anchor account space including discriminator.
    pub const SPACE: usize = 8 + Self::LEN;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ReceiptV2Ext {
    /// Reserved flags for future expansion.
    pub flags: u16,

    /// Optional explicit SPL mint mirror.
    /// Redundant with `Receipt.mint`, but useful for forward compatibility.
    pub spl_mint: Pubkey,

    /// Optional 32-byte reference (invoice/order/external correlation id).
    /// Zeroed when absent.
    pub reference: [u8; 32],

    /// Memo length in bytes. Zero when absent.
    pub memo_len: u8,

    /// Fixed-size memo buffer. Only the first `memo_len` bytes are meaningful.
    pub memo: [u8; 64],
}

impl ReceiptV2Ext {
    pub const FLAG_HAS_REFERENCE: u16 = 1 << 0;
    pub const FLAG_HAS_MEMO: u16 = 1 << 1;

    pub const MAX_MEMO_LEN: usize = 64;

    pub const LEN: usize =
        2 +  // flags
        32 + // spl_mint
        32 + // reference
        1 +  // memo_len
        64;  // memo

    pub fn sol() -> Self {
        Self {
            flags: 0,
            spl_mint: Pubkey::default(),
            reference: [0u8; 32],
            memo_len: 0,
            memo: [0u8; 64],
        }
    }

    pub fn spl(mint: Pubkey) -> Self {
        Self {
            flags: 0,
            spl_mint: mint,
            reference: [0u8; 32],
            memo_len: 0,
            memo: [0u8; 64],
        }
    }

    /// Build SPL receipt metadata with optional reference + memo.
    ///
    /// Safety:
    /// - Memo input is defensively bounded to MAX_MEMO_LEN.
    /// - Callers should still enforce protocol-level memo limits before this.
    pub fn spl_with_meta(
        mint: Pubkey,
        reference: Option<[u8; 32]>,
        memo: Option<&[u8]>,
    ) -> Self {
        let mut ext = Self::spl(mint);

        if let Some(r) = reference {
            ext.flags |= Self::FLAG_HAS_REFERENCE;
            ext.reference = r;
        }

        if let Some(m) = memo {
            let used = m.len().min(Self::MAX_MEMO_LEN);
            if used > 0 {
                ext.flags |= Self::FLAG_HAS_MEMO;
                ext.memo_len = used as u8;
                ext.memo[..used].copy_from_slice(&m[..used]);
            }
        }

        ext
    }
}

impl Default for ReceiptV2Ext {
    fn default() -> Self {
        Self {
            flags: 0,
            spl_mint: Pubkey::default(),
            reference: [0u8; 32],
            memo_len: 0,
            memo: [0u8; 64],
        }
    }
}

#[event]
pub struct ReceiptCreated {
    pub user: Pubkey,
    pub direction: u8,
    pub asset_kind: u8,
    pub mint: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub pre_balance: u64,
    pub post_balance: u64,
    pub ts: i64,
    pub tx_count: u64,
}

use anchor_lang::prelude::*;

#[account]
pub struct Receipt {
    /// User wallet (NOT the user_profile PDA)
    pub user: Pubkey,

    /// 0 = deposit, 1 = withdraw, 2 = pay
    pub direction: u8,


    /// 0 = SOL, 1 = SPL
    pub asset_kind: u8,

    /// SPL mint, or Pubkey::default() for SOL
    pub mint: Pubkey,

    /// Amount transferred (lamports for SOL, raw token units for SPL)
    pub amount: u64,

    /// Fee charged (same unit as amount; 0 for now if unused)
    pub fee: u64,

    /// User balance before (same unit as amount; for SPL, token units in user ATA)
    pub pre_balance: u64,

    /// User balance after (same unit as amount; for SPL, token units in user ATA)
    pub post_balance: u64,

    /// Unix timestamp at receipt creation
    pub ts: i64,

    /// Snapshot of user_profile.tx_count BEFORE increment
    pub tx_count: u64,

    /// PDA bump
    pub bump: u8,

    /// Extensible payload
    pub v2: ReceiptV2Ext,
}

impl Receipt {
    pub const DIR_DEPOSIT: u8 = 1;
    pub const DIR_WITHDRAW: u8 = 2;
    pub const DIR_PAY: u8 = 3;

    pub const ASSET_UNKNOWN: u8 = 0;
    pub const ASSET_SOL: u8 = 1;
    pub const ASSET_SPL: u8 = 2;


    /// Space excluding the 8-byte discriminator (Anchor adds that separately in init via `space = 8 + ...`)
    pub const LEN: usize = 32 + // user
        1  + // direction
        1  + // asset_kind
        32 + // mint
        8  + // amount
        8  + // fee
        8  + // pre_balance
        8  + // post_balance
        8  + // ts (i64)
        8  + // tx_count
        1  + // bump
        ReceiptV2Ext::LEN;

    /// Canonical PDA seeds for all receipts
    pub const RECEIPT_SEED: &[u8] = b"receipt";

    /// Canonical receipt PDA derivation
    /// MUST be mirrored exactly in tests/helpers
    pub fn receipt_seeds<'a>(
        treasury: &'a Pubkey,
        user: &'a Pubkey,
        mint: &'a Pubkey,
        tx_count: &'a [u8; 8],
        direction_seed: &'a [u8; 1],
    ) -> [&'a [u8]; 6] {
      [
        Receipt::RECEIPT_SEED.as_ref(),

        treasury.as_ref(),
        user.as_ref(),
        mint.as_ref(),
        tx_count.as_ref(),
        direction_seed.as_ref(),
      ]
    }



    /// Convenience for `space = 8 + Receipt::LEN`
    pub const SPACE: usize = 8 + Self::LEN;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ReceiptV2Ext {
    /// Reserved flags for future (bitfield)
    pub flags: u16,

    /// Optional: keep if you want future-proof explicit SPL mint storage.
    /// Redundant with `mint`, but harmless.
    pub spl_mint: Pubkey,

    /// Optional 32-byte reference (invoice/order id hash, etc.)
    /// Zeroed when absent.
    pub reference: [u8; 32],

    /// Memo length (0..=64). Zero when absent.
    pub memo_len: u8,

    /// Memo bytes (UTF-8 or arbitrary). Only first memo_len bytes are meaningful.
    pub memo: [u8; 64],
}

impl ReceiptV2Ext {
    pub const FLAG_HAS_REFERENCE: u16 = 1 << 0;
    pub const FLAG_HAS_MEMO: u16 = 1 << 1;

    pub const LEN: usize = 2 + 32 + 32 + 1 + 64;

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

    pub fn spl_with_meta(mint: Pubkey, reference: Option<[u8; 32]>, memo: Option<&[u8]>) -> Self {
        let mut ext = Self::spl(mint);

        if let Some(r) = reference {
            ext.flags |= Self::FLAG_HAS_REFERENCE;
            ext.reference = r;
        }

        if let Some(m) = memo {
            ext.flags |= Self::FLAG_HAS_MEMO;
            ext.memo_len = m.len() as u8;
            ext.memo[..m.len()].copy_from_slice(m);
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

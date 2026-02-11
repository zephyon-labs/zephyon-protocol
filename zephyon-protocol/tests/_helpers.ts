
// tests/_helpers.ts
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import type { AccountInfo } from "@solana/web3.js";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Connection,
} from "@solana/web3.js";
import * as fs from "fs";
import { expect } from "chai";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  createMint,
  mintTo,
} from "@solana/spl-token";

// Canon enums mirrored from Rust state/receipt.rs
export const DIR_DEPOSIT = 1;
export const DIR_WITHDRAW = 2;
export const DIR_PAY = 3;

export const ASSET_UNKNOWN = 0;
export const ASSET_SOL = 1;
export const ASSET_SPL = 2;
// Optional type import if you generated types
// import type { Protocol } from "../target/types/protocol";
// -----------------------------------------------------------------------------
// Nonce namespaces (TEST-ONLY)
// These prevent PDA collisions across different instruction families.
// Keep these disjoint forever.
// -----------------------------------------------------------------------------

export const NONCE_DEPOSIT_BASE = 100_000;
export const NONCE_PAY_BASE = 1_000_000;
export const NONCE_WITHDRAW_BASE = 10_000_000;


/* ─────────────────────────────────────────────────────────
 * Authority constant — must match tests/keys/protocol-authority.json
 * ───────────────────────────────────────────────────────── */
export const PROTOCOL_AUTHORITY = new PublicKey(
  "Hx2vTD7PrqH6nUEvP8AYo9qcsAfS9NpPcnqc2HJWmFcc"
);

/* ─────────────────────────────────────────────────────────
 * Program identity (via workspace IDL address)
 * ───────────────────────────────────────────────────────── */
export function getProgram(): Program<any> {
  const ws: any = (anchor.workspace as any).Protocol;
  if (!ws) {
    throw new Error(
      "anchor.workspace.Protocol is undefined — check declare_id!, Anchor.toml, and target/idl/protocol.json address."
    );
  }
  return ws as Program<any>;
}
export function PROGRAM_ID(): PublicKey {
  return getProgram().programId;
}


/* ─────────────────────────────────────────────────────────
 * Utils
 * ───────────────────────────────────────────────────────── */

/** EXACT little-endian u64 encoding (matches Rust `to_le_bytes()`). */
export function toLeU64(n: BN | bigint | number): Buffer {
  if (BN.isBN(n as any)) return (n as BN).toArrayLike(Buffer, "le", 8);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(
  typeof n === "bigint"
    ? n
    : typeof n === "number"
    ? BigInt(n)
    : BigInt(n.toString())
);

  return buf;
}
/** ✅ Canonical receipt PDA — SPL deposit with receipt
 * seeds = ["receipt", user, nonce_le_u64]
 */
export function deriveDepositReceiptPda(
  programId: PublicKey,
  user: PublicKey,
  nonce: BN | bigint | number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), user.toBuffer(), toLeU64(nonce)],
    programId
  );
}

/** ✅ Canonical receipt PDA — SPL withdraw with receipt
 * seeds = ["receipt", user, tx_count_le_u64]
 * NOTE: txCount must be PRE-INCREMENT snapshot (value before withdraw).
 */
export function deriveWithdrawReceiptPda(
  programId: PublicKey,
  user: PublicKey,
  txCount: BN | bigint | number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), user.toBuffer(), toLeU64(txCount)],
    programId
  );
}
/** ✅ Canonical receipt PDA — SPL pay with receipt
 * seeds = ["receipt", treasury, nonce_le_u64]
 */
export function derivePayReceiptPda(
  programId: PublicKey,
  treasury: PublicKey,
  nonce: BN | bigint | number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), treasury.toBuffer(), toLeU64(nonce)],
    programId
  );
}


export function deriveReceiptPdaV2(args: {
  program: anchor.Program;
  treasury: PublicKey;
  user: PublicKey;
  mint: PublicKey;
  txCount: bigint | number;
  direction: number; // 0 deposit, 1 withdraw, 2 pay
}): [PublicKey, number] {
  const { program, treasury, user, mint, txCount, direction } = args;

  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("receipt"),
      treasury.toBuffer(),
      user.toBuffer(),
      mint.toBuffer(),
      toLeU64(txCount),
      Buffer.from([direction]),
    ],
    program.programId
  );
}


// Back-compat alias if other specs still import leU64
export const leU64 = toLeU64;

/* ─────────────────────────────────────────────────────────
 * PDA derivations (zero-arg, use current PROGRAM_ID())
 * ───────────────────────────────────────────────────────── */
export function deriveProtocolStatePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_state")],
    PROGRAM_ID()
  );
}

export function deriveTreasuryPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    PROGRAM_ID()
  );
}


/** User profile PDA seeds (canonical):
 * ["user_profile", user_pubkey]
 */
export function deriveUserProfilePda(user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_profile"), user.toBuffer()],
    PROGRAM_ID()
  );
}


/** Canonical 2-arg seed variant */
export function deriveUserProfilePdaV3(
  programId: PublicKey,
  user: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_profile"), user.toBuffer()],
    programId
  );
}


/** ⚠️ LEGACY receipt PDA (old schema; keep only if older specs still use it)
 * Old seeds = ["receipt", user_profile, tx_count_le_u64]
 * Current program uses ["receipt", user, <u64>] for both deposit+withdraw receipts.
 */
export function deriveReceiptPdaByUserProfile(
  programId: PublicKey,
  userProfile: PublicKey,
  txCount: BN | bigint | number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), userProfile.toBuffer(), toLeU64(txCount)],
    programId
  );
}

/** ⚠️ Generic receipt PDA by user + le_u64
 * seeds = ["receipt", user, le_u64]
 * Prefer deriveDepositReceiptPda / deriveWithdrawReceiptPda for clarity.
 */

export function deriveReceiptPdaByUser(
  user: PublicKey,
  leTxCount: Buffer
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), user.toBuffer(), leTxCount],
    PROGRAM_ID()
  );
}

export const pda = {
  protocolState: () => deriveProtocolStatePda()[0],
  treasury: () => deriveTreasuryPda()[0],
  userProfileKeyOnly: (user: PublicKey) => deriveUserProfilePda(user)[0],
};
/** Read-only: pull raw account info (indexer-style access) */
export async function getAccountInfoOrNull(
  providerOrConn: AnchorProvider | Connection,
  address: PublicKey
): Promise<AccountInfo<Buffer> | null> {
  const conn =
    (providerOrConn as AnchorProvider).connection ??
    (providerOrConn as Connection);

  return await conn.getAccountInfo(address, "confirmed");
}

/** Read-only: decode Receipt from raw bytes using Anchor coder */
export function decodeReceiptFromAccountInfo(
  program: any,
  info: AccountInfo<Buffer>
) {
  return program.coder.accounts.decode("receipt", info.data);
}

/* ─────────────────────────────────────────────────────────
 * Authority key (must match PROTOCOL_AUTHORITY above)
 * ───────────────────────────────────────────────────────── */
export function loadProtocolAuthority(
  path = "tests/keys/protocol-authority.json"
): Keypair {
  if (!fs.existsSync(path))
    throw new Error(`Missing protocol authority keypair at ${path}`);
  const secret: number[] = JSON.parse(fs.readFileSync(path, "utf8"));
  const kp = Keypair.fromSecretKey(Uint8Array.from(secret));
  if (!kp.publicKey.equals(PROTOCOL_AUTHORITY)) {
    throw new Error(
      `protocol-authority pubkey mismatch. File=${kp.publicKey.toBase58()} vs const=${PROTOCOL_AUTHORITY.toBase58()}`
    );
  }
  return kp;
}

/* ─────────────────────────────────────────────────────────
 * Airdrop
 * ───────────────────────────────────────────────────────── */
export async function airdrop(
  providerOrConn: AnchorProvider | Connection,
  pubkey: PublicKey,
  amount: number = 2
) {
  const conn =
    (providerOrConn as AnchorProvider).connection ??
    (providerOrConn as Connection);
  const lamports =
    amount >= 1_000_000 ? amount : Math.floor(amount * LAMPORTS_PER_SOL);
  const sig = await conn.requestAirdrop(pubkey, lamports);
  await conn.confirmTransaction(sig, "confirmed");
}

/* ─────────────────────────────────────────────────────────
 * Foundation init (idempotent, verified)
 * ───────────────────────────────────────────────────────── */
export async function initFoundationOnce(
  provider: AnchorProvider,
  program: Program,
  _ignored?: any
) {
  const [treasuryPda] = deriveTreasuryPda();

  const protocolAuth = loadProtocolAuthority();
  await airdrop(provider, protocolAuth.publicKey, 2);

  // initialize_treasury (idempotent)
  try {
    await program.methods
      .initializeTreasury()
      .accounts({
        treasury: treasuryPda,
        authority: protocolAuth.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([protocolAuth])
      .rpc();
  } catch (_) {}

  // Verify treasury exists (this matches your actual program/IDL reality)
  try {
    await (program.account as any).treasury.fetch(treasuryPda);
  } catch (e) {
    throw new Error(
      `treasury NOT initialized. Check PROTOCOL_AUTHORITY vs tests/keys/protocol-authority.json and program ID vs target/idl/protocol.json.`
    );
  }

  return {
    programId: PROGRAM_ID(),
    treasuryPda,
    protocolAuth,
  };
}


/* ─────────────────────────────────────────────────────────
 * SPL helpers (mint + ATAs)
 * ───────────────────────────────────────────────────────── */
export async function setupMintAndAtas(
  provider: AnchorProvider,
  user: Keypair,
  treasuryOwner: PublicKey,
  initialUserAmount: bigint = 1_000_000n
) {
  const mint = await createMint(
    provider.connection,
    user,
    user.publicKey,
    null,
    6
  );

  const userAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    user,
    mint,
    user.publicKey
  );

  const treasuryAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    user,
    mint,
    treasuryOwner,
    true
  );

  await mintTo(
    provider.connection,
    user,
    mint,
    userAta.address,
    user.publicKey,
    Number(initialUserAmount)
  );

  return { mint, userAta, treasuryAta, tokenProgram: TOKEN_PROGRAM_ID };
}

/* ─────────────────────────────────────────────────────────
 * Convenient re-exports
 * ───────────────────────────────────────────────────────── */
export { BN, expect };












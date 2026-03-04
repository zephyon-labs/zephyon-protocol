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
  Transaction,
  SendOptions,
} from "@solana/web3.js";
import * as fs from "fs";
import { expect } from "chai";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  createMint,
  mintTo,
} from "@solana/spl-token";

/* ─────────────────────────────────────────────────────────
 * Canon enums mirrored from Rust (state/receipt.rs)
 * IMPORTANT: direction values are 1/2/3 (NOT 0/1/2)
 * ───────────────────────────────────────────────────────── */
export const DIR_DEPOSIT = 1;
export const DIR_WITHDRAW = 2;
export const DIR_PAY = 3;

export const ASSET_UNKNOWN = 0;
export const ASSET_SOL = 1;
export const ASSET_SPL = 2;

/* ─────────────────────────────────────────────────────────
 * Nonce namespaces (TEST-ONLY)
 * Prevent PDA collisions across instruction families.
 * Keep disjoint forever.
 * ───────────────────────────────────────────────────────── */
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

  const bn =
    typeof n === "bigint"
      ? n
      : typeof n === "number"
      ? BigInt(n)
      : BigInt(n.toString());

  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(bn);
  return buf;
}

// Back-compat alias if other specs still import leU64
export const leU64 = toLeU64;

/* ─────────────────────────────────────────────────────────
 * Canonical receipt PDA derivations (current schema)
 * NOTE: These must match the on-chain seeds exactly.
 * ───────────────────────────────────────────────────────── */

/** ✅ Canonical receipt PDA — SPL deposit
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

/** ✅ Canonical receipt PDA — SPL withdraw
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

/** ✅ Canonical receipt PDA — SPL pay
 * seeds = ["receipt", treasury, pay_count_le_u64]
 * NOTE: payCount must be PRE-INCREMENT snapshot (value before pay).
 */
export function derivePayReceiptPda(
  programId: PublicKey,
  treasury: PublicKey,
  payCount: BN | bigint | number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), treasury.toBuffer(), toLeU64(payCount)],
    programId
  );
}

/** ✅ Receipt PDA V2 schema (if/when used by program)
 * seeds = ["receipt", treasury, user, mint, txCount_le_u64, direction_u8]
 * IMPORTANT: direction is 1/2/3 (DIR_DEPOSIT/DIR_WITHDRAW/DIR_PAY)
 */
export function deriveReceiptPdaV2(args: {
  program: anchor.Program;
  treasury: PublicKey;
  user: PublicKey;
  mint: PublicKey;
  txCount: bigint | number | BN;
  direction: number; // must be 1/2/3
}): [PublicKey, number] {
  const { program, treasury, user, mint, txCount, direction } = args;

  if (![DIR_DEPOSIT, DIR_WITHDRAW, DIR_PAY].includes(direction)) {
    throw new Error(
      `Invalid direction=${direction}. Expected 1/2/3 (DIR_DEPOSIT/DIR_WITHDRAW/DIR_PAY).`
    );
  }

  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("receipt"),
      treasury.toBuffer(),
      user.toBuffer(),
      mint.toBuffer(),
      toLeU64(txCount as any),
      Buffer.from([direction]),
    ],
    program.programId
  );
}

/* ─────────────────────────────────────────────────────────
 * PDA derivations (zero-arg uses current PROGRAM_ID())
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

/** User profile PDA seeds (canonical): ["user_profile", user_pubkey] */
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

/* ─────────────────────────────────────────────────────────
 * LEGACY (keep only if older specs still depend on it)
 * DO NOT USE for new tests.
 * ───────────────────────────────────────────────────────── */

/** ⚠️ LEGACY receipt PDA (old schema)
 * Old seeds = ["receipt", user_profile, tx_count_le_u64]
 */
export function deriveReceiptPdaByUserProfile_LEGACY(
  programId: PublicKey,
  userProfile: PublicKey,
  txCount: BN | bigint | number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), userProfile.toBuffer(), toLeU64(txCount)],
    programId
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
 * Authority key loader (must match PROTOCOL_AUTHORITY)
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
 * Raw send helper (explicit, avoids provider wallet surprises)
 * ───────────────────────────────────────────────────────── */
export async function sendTx(
  provider: AnchorProvider,
  tx: Transaction,
  signers: Keypair[],
  opts: SendOptions = { skipPreflight: false, preflightCommitment: "confirmed" }
): Promise<string> {
  tx.feePayer = signers[0]?.publicKey ?? provider.wallet.publicKey;
  tx.recentBlockhash = (await provider.connection.getLatestBlockhash("confirmed"))
    .blockhash;

  tx.sign(...signers);

  const sig = await provider.connection.sendRawTransaction(
    tx.serialize(),
    opts
  );

  await provider.connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/* ─────────────────────────────────────────────────────────
 * Foundation init (idempotent, verified, wallet-agnostic)
 * ───────────────────────────────────────────────────────── */
export async function initFoundationOnce(
  provider: AnchorProvider,
  program: Program,
  _ignored?: any
) {
  const [treasuryPda] = deriveTreasuryPda();
  const protocolAuth = loadProtocolAuthority();

  // ensure protocolAuth can pay fees if we use it as fee payer anywhere
  await airdrop(provider, protocolAuth.publicKey, 2);

  // initialize_treasury (idempotent)
  try {
    const ix = await program.methods
      .initializeTreasury()
      .accounts({
        treasury: treasuryPda,
        authority: protocolAuth.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const tx = new Transaction().add(ix);
    await sendTx(provider, tx, [protocolAuth], {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
  } catch (_) {
    // ignore if already initialized or expected idempotent fail
  }

  // Verify treasury exists
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
  payer: Keypair,
  treasuryOwner: PublicKey,
  initialUserAmount: bigint = 1_000_000n,
  decimals = 6
) {
  // ensure payer has SOL for mint/ATA fees if needed
  // (tests may already do this, but no harm keeping it deterministic)
  // await airdrop(provider, payer.publicKey, 1);

  const mint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    null,
    decimals
  );

  const userAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    mint,
    payer.publicKey
  );

  const treasuryAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    mint,
    treasuryOwner,
    true
  );

  // spl-token supports bigint amounts; keep bigint to avoid precision loss
  await mintTo(
    provider.connection,
    payer,
    mint,
    userAta.address,
    payer.publicKey,
    initialUserAmount
  );

  return { mint, userAta, treasuryAta, tokenProgram: TOKEN_PROGRAM_ID };
}

/* ─────────────────────────────────────────────────────────
 * Tier2 infra: bounded concurrency + retry
 * ───────────────────────────────────────────────────────── */
export async function runBounded<T>(
  concurrency: number,
  items: T[],
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  const queue = items.map((item, index) => ({ item, index }));
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (!next) return;
      await worker(next.item, next.index);
    }
  });
  await Promise.all(workers);
}

type RetryOpts = {
  retries?: number;
  baseDelayMs?: number;
  label?: string;
  shouldRetry?: (e: any) => boolean;
};

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {}
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 200;

  const defaultShouldRetry = (e: any) => {
    const msg = String(e?.message ?? e);

    // logical failures => DO NOT retry
    const logicalFailures = [
      "ProtocolPaused",
      "Unauthorized",
      "UnauthorizedWithdraw",
      "Constraint",
      "has_one",
      "seeds constraint",
    ];
    if (logicalFailures.some((s) => msg.includes(s))) return false;

    // transient infra failures => retry
    return (
      msg.includes("Blockhash not found") ||
      msg.includes("Transaction was not confirmed") ||
      msg.includes("Node is behind") ||
      msg.includes("429") ||
      msg.includes("Too many requests") ||
      msg.includes("AccountInUse") ||
      msg.includes("already in use") ||
      msg.includes("Timed out") ||
      msg.includes("timeout")
    );
  };

  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;
  let lastErr: any;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === retries || !shouldRetry(e)) throw e;
      const delay = baseDelayMs * (attempt + 1);
      await sleep(delay);
    }
  }

  throw lastErr;
}

/* ─────────────────────────────────────────────────────────
 * Convenient re-exports
 * ───────────────────────────────────────────────────────── */
export { BN, expect };












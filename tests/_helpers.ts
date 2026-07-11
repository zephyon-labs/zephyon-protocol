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
  Commitment,
} from "@solana/web3.js";
import * as fs from "fs";
import { expect } from "chai";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
} from "@solana/spl-token";

/* ─────────────────────────────────────────────────────────
 * Canon enums mirrored from Rust (state/receipt.rs)
 * Current live values:
 * - direction: 1/2/3
 * - asset kind: 0/1/2
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
 * Basic utils
 * ───────────────────────────────────────────────────────── */

/** EXACT little-endian u64 encoding (matches Rust `to_le_bytes()`). */
export function toLeU64(n: BN | bigint | number): Buffer {
  if (BN.isBN(n as any)) return (n as BN).toArrayLike(Buffer, "le", 8);

  const value =
    typeof n === "bigint"
      ? n
      : typeof n === "number"
      ? BigInt(n)
      : BigInt(n.toString());

  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

// Back-compat alias
export const leU64 = toLeU64;

export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function bigintAbs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

export function bigintEq(a: bigint, b: bigint, label?: string) {
  expect(a.toString(), label ?? "bigint equality mismatch").to.eq(b.toString());
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

/* ─────────────────────────────────────────────────────────
 * Receipt PDA derivations
 * ───────────────────────────────────────────────────────── */

/** Canonical receipt PDA — SPL deposit
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

/** Canonical receipt PDA — SPL withdraw
 * seeds = ["receipt", user, tx_count_le_u64]
 * txCount must be PRE-INCREMENT snapshot.
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

/** Canonical receipt PDA — SPL pay
 * seeds = ["receipt", treasury, pay_count_le_u64]
 * payCount must be PRE-INCREMENT snapshot.
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

/** Historical / V2-style generalized receipt PDA helper.
 * seeds = ["receipt", treasury, user, mint, txCount_le_u64, direction_u8]
 */
export function deriveReceiptPdaV2(args: {
  program: anchor.Program;
  treasury: PublicKey;
  user: PublicKey;
  mint: PublicKey;
  txCount: bigint | number | BN;
  direction: number;
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

/** LEGACY receipt PDA (old schema)
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

/* ─────────────────────────────────────────────────────────
 * PDA derivations
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

export function deriveUserProfilePda(user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_profile"), user.toBuffer()],
    PROGRAM_ID()
  );
}

export function deriveUserProfilePdaV3(
  programId: PublicKey,
  user: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_profile"), user.toBuffer()],
    programId
  );
}

export const pda = {
  protocolState: () => deriveProtocolStatePda()[0],
  treasury: () => deriveTreasuryPda()[0],
  userProfileKeyOnly: (user: PublicKey) => deriveUserProfilePda(user)[0],
};

/* ─────────────────────────────────────────────────────────
 * Raw account helpers
 * ───────────────────────────────────────────────────────── */
export async function getAccountInfoOrNull(
  providerOrConn: AnchorProvider | Connection,
  address: PublicKey,
  commitment: Commitment = "finalized"
): Promise<AccountInfo<Buffer> | null> {
  const conn =
    (providerOrConn as AnchorProvider).connection ??
    (providerOrConn as Connection);

  return await conn.getAccountInfo(address, commitment);
}

export function decodeReceiptFromAccountInfo(
  program: any,
  info: AccountInfo<Buffer>
) {
  return program.coder.accounts.decode("receipt", info.data);
}

export async function receiptExists(
  providerOrConn: AnchorProvider | Connection,
  address: PublicKey,
  commitment: Commitment = "finalized"
): Promise<boolean> {
  const info = await getAccountInfoOrNull(providerOrConn, address, commitment);
  return !!info;
}

export async function fetchReceiptOrNull(
  providerOrConn: AnchorProvider | Connection,
  program: any,
  address: PublicKey,
  commitment: Commitment = "finalized"
): Promise<any | null> {
  const info = await getAccountInfoOrNull(providerOrConn, address, commitment);
  if (!info) return null;
  return decodeReceiptFromAccountInfo(program, info);
}

/* ─────────────────────────────────────────────────────────
 * Treasury state helpers
 * ───────────────────────────────────────────────────────── */
export async function fetchTreasuryOrThrow(
  program: Program<any>,
  treasuryPda?: PublicKey
): Promise<any> {
  const treasury = treasuryPda ?? deriveTreasuryPda()[0];
  return await (program.account as any).treasury.fetch(treasury);
}

export async function getTreasuryPayCount(
  program: Program<any>,
  treasuryPda?: PublicKey
): Promise<bigint> {
  const treasury = await fetchTreasuryOrThrow(program, treasuryPda);
  return BigInt(treasury.payCount.toString());
}

export async function getTreasuryPaused(
  program: Program<any>,
  treasuryPda?: PublicKey
): Promise<boolean> {
  const treasury = await fetchTreasuryOrThrow(program, treasuryPda);
  return !!treasury.paused;
}

export async function snapshotTreasuryState(
  program: Program<any>,
  treasuryPda?: PublicKey
): Promise<{
  treasuryPda: PublicKey;
  authority: PublicKey;
  paused: boolean;
  bump: number;
  payCount: bigint;
}> {
  const key = treasuryPda ?? deriveTreasuryPda()[0];
  const treasury = await fetchTreasuryOrThrow(program, key);

  return {
    treasuryPda: key,
    authority: treasury.authority as PublicKey,
    paused: !!treasury.paused,
    bump: treasury.bump as number,
    payCount: BigInt(treasury.payCount.toString()),
  };
}

/* ─────────────────────────────────────────────────────────
 * Token balance + invariant snapshot helpers
 * ───────────────────────────────────────────────────────── */
export async function getTokenBalanceOrZero(
  providerOrConn: AnchorProvider | Connection,
  ata: PublicKey
): Promise<bigint> {
  const conn =
    (providerOrConn as AnchorProvider).connection ??
    (providerOrConn as Connection);

  const info = await conn.getAccountInfo(ata, "finalized");
  if (!info) return 0n;

  const acct = await getAccount(conn, ata, "finalized", TOKEN_PROGRAM_ID);
  return BigInt(acct.amount.toString());
}

export type TokenBalanceSnapshot = {
  label?: string;
  mint?: PublicKey;
  treasuryAta: PublicKey;
  treasuryBalance: bigint;
  userAtas: PublicKey[];
  userBalances: bigint[];
  totalTracked: bigint;
};

export async function snapshotTokenBalances(args: {
  providerOrConn: AnchorProvider | Connection;
  treasuryAta: PublicKey;
  userAtas: PublicKey[];
  mint?: PublicKey;
  label?: string;
}): Promise<TokenBalanceSnapshot> {
  const { providerOrConn, treasuryAta, userAtas, mint, label } = args;

  const treasuryBalance = await getTokenBalanceOrZero(providerOrConn, treasuryAta);
  const userBalances = await Promise.all(
    userAtas.map((ata) => getTokenBalanceOrZero(providerOrConn, ata))
  );

  const totalTracked = userBalances.reduce(
    (acc, n) => acc + n,
    treasuryBalance
  );

  return {
    label,
    mint,
    treasuryAta,
    treasuryBalance,
    userAtas: [...userAtas],
    userBalances,
    totalTracked,
  };
}

export function assertTrackedInvariantUnchanged(
  before: TokenBalanceSnapshot,
  after: TokenBalanceSnapshot,
  label = "tracked invariant changed unexpectedly"
) {
  bigintEq(before.totalTracked, after.totalTracked, label);
}

export function sumBigints(values: bigint[]): bigint {
  return values.reduce((acc, n) => acc + n, 0n);
}

export function aggregateUserDelta(
  before: TokenBalanceSnapshot,
  after: TokenBalanceSnapshot
): bigint {
  if (before.userBalances.length !== after.userBalances.length) {
    throw new Error("aggregateUserDelta length mismatch");
  }

  let delta = 0n;
  for (let i = 0; i < before.userBalances.length; i++) {
    delta += after.userBalances[i] - before.userBalances[i];
  }
  return delta;
}

export function treasuryDelta(
  before: TokenBalanceSnapshot,
  after: TokenBalanceSnapshot
): bigint {
  return before.treasuryBalance - after.treasuryBalance;
}

/* ─────────────────────────────────────────────────────────
 * Authority key loader
 * ───────────────────────────────────────────────────────── */
export function loadProtocolAuthority(
  path = "tests/keys/protocol-authority.json"
): Keypair {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing protocol authority keypair at ${path}`);
  }

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
 * Airdrop + transport helpers
 * ───────────────────────────────────────────────────────── */

async function confirmSignatureWithBlockhash(
  conn: Connection,
  signature: string,
  commitment: Commitment = "finalized",
  latest?: { blockhash: string; lastValidBlockHeight: number }
) {
  const bh = latest ?? (await conn.getLatestBlockhash("finalized"));
  await conn.confirmTransaction(
    {
      signature,
      blockhash: bh.blockhash,
      lastValidBlockHeight: bh.lastValidBlockHeight,
    },
    commitment
  );
}

export async function airdrop(
  providerOrConn: AnchorProvider | Connection,
  pubkey: PublicKey,
  amount: number = 2,
  commitment: Commitment = "finalized"
) {
  const conn =
    (providerOrConn as AnchorProvider).connection ??
    (providerOrConn as Connection);

  const lamports =
    amount >= 1_000_000 ? amount : Math.floor(amount * LAMPORTS_PER_SOL);

  const latest = await conn.getLatestBlockhash("finalized");
  const sig = await conn.requestAirdrop(pubkey, lamports);
  await confirmSignatureWithBlockhash(conn, sig, commitment, latest);
  return sig;
}

export type AttemptResult = "success" | "rejected" | "skipped";

export async function sendRawTxFresh(args: {
  provider: AnchorProvider;
  tx: Transaction;
  signers: Keypair[];
  feePayer?: PublicKey;
  commitment?: Commitment;
  opts?: SendOptions;
}): Promise<string> {
  const {
    provider,
    tx,
    signers,
    feePayer,
    commitment = "finalized",
    opts,
  } = args;

  const latest = await provider.connection.getLatestBlockhash("finalized");

  tx.feePayer =
    feePayer ?? signers[0]?.publicKey ?? provider.wallet.publicKey;
  tx.recentBlockhash = latest.blockhash;

  tx.sign(...signers);

  const sig = await provider.connection.sendRawTransaction(
    tx.serialize(),
    opts ?? {
      skipPreflight: false,
      preflightCommitment: "finalized",
    }
  );

  await confirmSignatureWithBlockhash(
    provider.connection,
    sig,
    commitment,
    latest
  );

  const statusResp = await provider.connection.getSignatureStatuses([sig]);
  const status = statusResp.value[0];

  if (!status) {
    throw new Error(`Missing signature status for ${sig}`);
  }

  if (status.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
  }

  return sig;
}

export async function sendTx(
  provider: AnchorProvider,
  tx: Transaction,
  signers: Keypair[],
  opts: SendOptions = {
    skipPreflight: false,
    preflightCommitment: "finalized",
  }
): Promise<string> {
  return await sendRawTxFresh({
    provider,
    tx,
    signers,
    opts,
    commitment: "finalized",
  });
}

export async function sendTxExplicit(args: {
  provider: AnchorProvider;
  tx: Transaction;
  signers: Keypair[];
  feePayer: PublicKey;
  opts?: SendOptions;
  commitment?: Commitment;
}): Promise<string> {
  const { provider, tx, signers, feePayer, opts } = args;

  return await sendRawTxFresh({
    provider,
    tx,
    signers,
    feePayer,
    opts:
      opts ?? {
        skipPreflight: false,
        preflightCommitment: "finalized",
      },
    commitment: "finalized",
  });
}

/* ─────────────────────────────────────────────────────────
 * Retry helpers
 * ───────────────────────────────────────────────────────── */
export type RetryOpts = {
  retries?: number;
  baseDelayMs?: number;
  label?: string;
  shouldRetry?: (e: any) => boolean;
};

export type RetryResult<T> = {
  value: T;
  attemptsUsed: number;
  retried: boolean;
};

export function defaultShouldRetry(e: any): boolean {
  const msg = String(e?.message ?? e);

  const logicalFailures = [
    "ProtocolPaused",
    "TreasuryPaused",
    "Unauthorized",
    "UnauthorizedWithdraw",
    "Constraint",
    "has_one",
    "seeds constraint",
    "CounterOverflow",
    "InvalidAmount",
    "InvalidMint",
  ];
  if (logicalFailures.some((s) => msg.includes(s))) return false;

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
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {}
): Promise<T> {
  const res = await withRetryInfo(fn, opts);
  return res.value;
}

export async function withRetryInfo<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {}
): Promise<RetryResult<T>> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 200;
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;

  let lastErr: any;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const value = await fn();
      return {
        value,
        attemptsUsed: attempt + 1,
        retried: attempt > 0,
      };
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
 * Strict SPL infrastructure
 * ───────────────────────────────────────────────────────── */

async function assertAccountOwnedBy(
  conn: Connection,
  address: PublicKey,
  owner: PublicKey,
  label: string
) {
  const info = await conn.getAccountInfo(address, "finalized");
  if (!info) {
    throw new Error(`${label}: account missing: ${address.toBase58()}`);
  }
  if (!info.owner.equals(owner)) {
    throw new Error(
      `${label}: owner mismatch for ${address.toBase58()}. got=${info.owner.toBase58()} expected=${owner.toBase58()}`
    );
  }
}

export async function createMintStrict(args: {
  provider: AnchorProvider;
  payer: Keypair;
  mintAuthority: PublicKey;
  freezeAuthority?: PublicKey | null;
  decimals?: number;
}): Promise<PublicKey> {
  const {
    provider,
    payer,
    mintAuthority,
    freezeAuthority = null,
    decimals = 6,
  } = args;

  const mint = Keypair.generate();
  const lamports =
    await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE, "finalized");

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mint.publicKey,
      decimals,
      mintAuthority,
      freezeAuthority,
      TOKEN_PROGRAM_ID
    )
  );

  await sendRawTxFresh({
    provider,
    tx,
    signers: [payer, mint],
    commitment: "finalized",
  });

  await withRetry(
    async () => {
      await assertAccountOwnedBy(
        provider.connection,
        mint.publicKey,
        TOKEN_PROGRAM_ID,
        "createMintStrict"
      );
    },
    {
      label: "createMintStrict-visible",
      retries: 12,
      baseDelayMs: 100,
    }
  );

  return mint.publicKey;
}

export async function createAtaStrict(args: {
  provider: AnchorProvider;
  payer: Keypair;
  mint: PublicKey;
  owner: PublicKey;
  allowOwnerOffCurve?: boolean;
}): Promise<PublicKey> {
  const {
    provider,
    payer,
    mint,
    owner,
    allowOwnerOffCurve = false,
  } = args;

  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    allowOwnerOffCurve,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const existing = await provider.connection.getAccountInfo(ata, "finalized");
  if (existing) {
    await assertAccountOwnedBy(
      provider.connection,
      ata,
      TOKEN_PROGRAM_ID,
      "createAtaStrict-existing"
    );
    return ata;
  }

  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ata,
      owner,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );

  await withRetry(
    async () => {
      try {
        await sendRawTxFresh({
          provider,
          tx,
          signers: [payer],
          commitment: "finalized",
        });
      } catch (e: any) {
        const msg = String(e?.message ?? e).toLowerCase();
        if (msg.includes("already in use") || msg.includes("custom program error: 0x0")) {
          const nowExists = await provider.connection.getAccountInfo(ata, "finalized");
          if (nowExists) return;
        }
        throw e;
      }
    },
    {
      label: `createAtaStrict-${ata.toBase58().slice(0, 8)}`,
      retries: 8,
      baseDelayMs: 120,
    }
  );

  await withRetry(
    async () => {
      await assertAccountOwnedBy(
        provider.connection,
        ata,
        TOKEN_PROGRAM_ID,
        "createAtaStrict-visible"
      );
    },
    {
      label: `createAtaStrict-visible-${ata.toBase58().slice(0, 8)}`,
      retries: 12,
      baseDelayMs: 100,
    }
  );

  return ata;
}

export async function mintToStrict(args: {
  provider: AnchorProvider;
  payer: Keypair;
  mint: PublicKey;
  destinationAta: PublicKey;
  mintAuthoritySigner: Keypair;
  amount: bigint;
}): Promise<string> {
  const {
    provider,
    payer,
    mint,
    destinationAta,
    mintAuthoritySigner,
    amount,
  } = args;

  if (amount < 0n) {
    throw new Error(`mintToStrict: amount cannot be negative (${amount.toString()})`);
  }

  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      `mintToStrict: amount ${amount.toString()} exceeds Number.MAX_SAFE_INTEGER; add bigint chunking if you need larger test mints`
    );
  }

  const tx = new Transaction().add(
    createMintToInstruction(
      mint,
      destinationAta,
      mintAuthoritySigner.publicKey,
      Number(amount),
      [],
      TOKEN_PROGRAM_ID
    )
  );

  const sig = await sendRawTxFresh({
    provider,
    tx,
    signers: [payer, mintAuthoritySigner],
    commitment: "finalized",
  });

  return sig;
}

/* ─────────────────────────────────────────────────────────
 * Foundation init
 * ───────────────────────────────────────────────────────── */
export async function initFoundationOnce(
  provider: AnchorProvider,
  program: Program,
  _ignored?: any
) {
  const [treasuryPda] = deriveTreasuryPda();
  const protocolAuth = loadProtocolAuthority();

  await airdrop(provider, protocolAuth.publicKey, 2, "finalized");

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
      preflightCommitment: "finalized",
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const likelyIdempotent =
      msg.includes("already in use") ||
      msg.includes("custom program error") ||
      msg.toLowerCase().includes("account already") ||
      msg.toLowerCase().includes("initialized");

    if (!likelyIdempotent) {
      throw e;
    }
  }

  try {
    await (program.account as any).treasury.fetch(treasuryPda);
  } catch {
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
 * SPL helpers
 * ───────────────────────────────────────────────────────── */
export async function setupMintAndAtas(
  provider: AnchorProvider,
  payer: Keypair,
  treasuryOwner: PublicKey,
  initialUserAmount: bigint = 1_000_000n,
  decimals = 6
) {
  return setupMintAndAtasStrict({
    provider,
    payer,
    treasuryOwner,
    initialUserAmount,
    decimals,
  });
}

export async function setupMintAndAtasStrict(args: {
  provider: AnchorProvider;
  payer: Keypair;
  treasuryOwner: PublicKey;
  initialUserAmount?: bigint;
  decimals?: number;
}): Promise<{
  mint: PublicKey;
  userAta: PublicKey;
  treasuryAta: PublicKey;
  tokenProgram: PublicKey;
  associatedTokenProgram: PublicKey;
}> {
  const {
    provider,
    payer,
    treasuryOwner,
    initialUserAmount = 1_000_000n,
    decimals = 6,
  } = args;

  const mint = await createMintStrict({
    provider,
    payer,
    mintAuthority: payer.publicKey,
    freezeAuthority: null,
    decimals,
  });

  const userAta = await createAtaStrict({
    provider,
    payer,
    mint,
    owner: payer.publicKey,
    allowOwnerOffCurve: false,
  });

  const treasuryAta = await createAtaStrict({
    provider,
    payer,
    mint,
    owner: treasuryOwner,
    allowOwnerOffCurve: true,
  });

  await withRetry(
    async () => {
      await mintToStrict({
        provider,
        payer,
        mint,
        destinationAta: userAta,
        mintAuthoritySigner: payer,
        amount: initialUserAmount,
      });
    },
    {
      label: "setupMintAndAtasStrict-mintTo",
      retries: 10,
      baseDelayMs: 120,
    }
  );

  await withRetry(
    async () => {
      const bal = await getTokenBalanceOrZero(provider, userAta);
      if (bal < initialUserAmount) {
        throw new Error(
          `setupMintAndAtasStrict: user ATA not funded yet. got=${bal.toString()} expected>=${initialUserAmount.toString()}`
        );
      }
    },
    {
      label: "setupMintAndAtasStrict-userAta-funded",
      retries: 12,
      baseDelayMs: 100,
    }
  );

  return {
    mint,
    userAta,
    treasuryAta,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  };
}

/* ─────────────────────────────────────────────────────────
 * Concurrency helpers
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

export async function runBoundedJittered<T>(args: {
  concurrency: number;
  items: T[];
  worker: (item: T, index: number) => Promise<void>;
  shuffle?: boolean;
  minDelayMs?: number;
  maxDelayMs?: number;
}): Promise<void> {
  const {
    concurrency,
    worker,
    shuffle = true,
    minDelayMs = 0,
    maxDelayMs = 25,
  } = args;

  const items = [...args.items];
  if (shuffle) shuffleInPlace(items);

  await runBounded(concurrency, items, async (item, index) => {
    if (maxDelayMs > 0) {
      const delay =
        minDelayMs +
        Math.floor(Math.random() * Math.max(1, maxDelayMs - minDelayMs + 1));
      await sleep(delay);
    }
    await worker(item, index);
  });
}

/* ─────────────────────────────────────────────────────────
 * Convenient re-exports
 * ───────────────────────────────────────────────────────── */
export { BN, expect };












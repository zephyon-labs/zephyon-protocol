
// tests/_helpers.ts
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
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

// Optional type import if you generated types
// import type { Protocol } from "../target/types/protocol";

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
  buf.writeBigUInt64LE(typeof n === "bigint" ? n : BigInt(n));
  return buf;
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


/** User profile PDA seeds:
 * ["user_profile", protocol_state, user_pubkey]
 */
export function deriveUserProfilePda(user: PublicKey): [PublicKey, number] {
  const [protocolState] = deriveProtocolStatePda();
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_profile"), protocolState.toBuffer(), user.toBuffer()],
    PROGRAM_ID()
  );
}

/** Canonical 3-arg variant (used by some SPL tests) */
export function deriveUserProfilePdaV3(
  programId: PublicKey,
  protocolState: PublicKey,
  user: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_profile"), protocolState.toBuffer(), user.toBuffer()],
    programId
  );
}

/** ✅ Receipt PDA — canonical for Core12:
 * ["receipt", user_profile.key(), tx_count.to_le_bytes()]
 * NOTE: txCount must be PRE-INCREMENT snapshot (value before deposit).
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

/** ❌ DEPRECATED — Do NOT use for Core12 receipts.
 * Kept only to avoid breaking older specs.
 * Your program does NOT derive receipts by user pubkey.
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
  const [protocolStatePda] = deriveProtocolStatePda();

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

  // initialize_protocol (idempotent)
  try {
    await program.methods
      .initializeProtocol()
      .accounts({
        protocolState: protocolStatePda,
        authority: protocolAuth.publicKey,
        treasury: treasuryPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([protocolAuth])
      .rpc();
  } catch (_) {}

  // hard verification — relax type name via any
  try {
    await (program.account as any).protocolState.fetch(protocolStatePda);
  } catch (e) {
    throw new Error(
      `protocol_state NOT initialized. Check PROTOCOL_AUTHORITY vs tests/keys/protocol-authority.json and program ID vs target/idl/protocol.json.`
    );
  }

  return {
    programId: PROGRAM_ID(),
    treasuryPda,
    protocolStatePda,
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












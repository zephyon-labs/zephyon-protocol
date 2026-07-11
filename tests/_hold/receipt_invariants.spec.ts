import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { SystemProgram, PublicKey, Keypair } from "@solana/web3.js";
import { expect } from "chai";

import { Protocol } from "../target/types/protocol";

import {
  initFoundationOnce,
  deriveTreasuryPda,

  loadProtocolAuthority,
  airdrop,
} from "./_helpers";

import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

function u64LE(n: number) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n), 0);
  return buf;
}

function deriveReceiptPda(programId: anchor.web3.PublicKey, user: anchor.web3.PublicKey, nonce: number) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), user.toBuffer(), u64LE(nonce)],
    programId
  );
}


describe("protocol - receipt invariants", () => {
  const userProvider = anchor.AnchorProvider.env();
  anchor.setProvider(userProvider);

  // Workspace program handles
  const programUser = anchor.workspace.Protocol as Program<Protocol>;

  // Shared constants for this file
  const DECIMALS = 6;
  const AMOUNT = new BN(500_000);

  // Utility: fast assert helper (keeps test bodies clean)
  function assertEqPubkey(label: string, a: PublicKey, b: PublicKey) {
    expect(a.toBase58(), `${label} mismatch`).to.eq(b.toBase58());
  }

  // Utility: string match for Anchor errors
  function errStr(e: any) {
    return String(e?.message ?? e).toLowerCase();
  }

  // ─────────────────────────────────────────────────────────────
  // TEST SETUP (runs before each test)
  // - ensures treasury exists
  // - creates mint + user ATA
  // - ensures treasury ATA exists only when we want it
  // - optional: switches auth provider when needed
  // ─────────────────────────────────────────────────────────────
  async function setupBase() {
    const protocolAuth = loadProtocolAuthority();
    await airdrop(userProvider, protocolAuth.publicKey, 2);

    // Authority provider (for init + withdraw-with-receipt, etc.)
    const authProvider = new anchor.AnchorProvider(
      userProvider.connection,
      new anchor.Wallet(protocolAuth),
      userProvider.opts
    );

    const [treasuryPda] = deriveTreasuryPda();

    // init must run under authority context
    anchor.setProvider(authProvider);
    const programAuth = anchor.workspace.Protocol as Program<Protocol>;
    await initFoundationOnce(authProvider, programAuth as any, protocolAuth);

    // back to user context
    anchor.setProvider(userProvider);

    const conn = userProvider.connection;
    const payer = (userProvider.wallet as any).payer;
    const user = userProvider.wallet.publicKey;

    const mint = await createMint(conn, payer, protocolAuth.publicKey, null, DECIMALS);

    const userAta = await getOrCreateAssociatedTokenAccount(conn, payer, mint, user);
    const treasuryAta = await getOrCreateAssociatedTokenAccount(
      conn,
      payer,
      mint,
      treasuryPda,
      true // allowOwnerOffCurve
    );

    // fund user tokens
    await mintTo(conn, payer, mint, userAta.address, protocolAuth, 1_000_000n);

    return {
      conn,
      protocolAuth,
      authProvider,
      programAuth,
      user,
      treasuryPda,
      mint,
      userAta,
      treasuryAta,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // A) RECEIPT CORRECTNESS
  // "Receipt fields reflect reality of the transfer"
  // ─────────────────────────────────────────────────────────────
  it("A1: deposit-with-receipt writes correct mint/amount/user/treasury linkage", async () => {
    const s = await setupBase();

    // ACT: perform deposit WITH receipt
    // TODO: call `splDepositWithReceipt(...)` exactly like your existing receipt test

    // TODO: derive receipt PDA and fetch receipt account

    // ASSERT (examples; match your receipt fields)
    // assertEqPubkey("receipt.treasury", receipt.treasury, s.treasuryPda);
    // assertEqPubkey("receipt.user", receipt.user, s.user);
    // assertEqPubkey("receipt.mint", receipt.mint, s.mint);
    // expect(receipt.amount.toString()).to.eq(AMOUNT.toString());

    // TODO: also assert balances moved exactly by AMOUNT
  });

  it("A2: withdraw-with-receipt writes correct mint/amount/user/treasury linkage", async () => {
    const s = await setupBase();

    // PREP: deposit first so treasury has balance
    // TODO: deposit (with or without receipt) so treasuryAta has funds

    // ACT: perform withdraw WITH receipt as authority signer
    // TODO: call `splWithdrawWithReceipt(...)` using programAuth + protocolAuth signer

    // TODO: derive receipt PDA and fetch receipt account

    // ASSERT invariants (same set as A1)
  });

  // ─────────────────────────────────────────────────────────────
  // B) RECEIPT LIFECYCLE / REPLAY SAFETY
  // "A receipt cannot be reused or forged to double-spend"
  // ─────────────────────────────────────────────────────────────
  it("B1: cannot replay the same withdraw-with-receipt (same nonce) twice", async () => {
    const s = await setupBase();

    // PREP: deposit to treasury
    // TODO

    // ACT #1: withdraw-with-receipt with nonce N
    // TODO

    // ACT #2: attempt again with SAME nonce N
    try {
      // TODO: second withdraw-with-receipt call
      expect.fail("expected replay to fail");
    } catch (e: any) {
      // ASSERT: should be a specific error (AlreadyUsed/ReceiptExists/etc.)
      // expect(errStr(e)).to.include("already");
      // or if you have a custom code, match that
    }
  });

  it("B2: cannot create a receipt with mismatched treasury/user/mint accounts", async () => {
    const s = await setupBase();

    // Goal: pass accounts that would “lie” (e.g. wrong treasuryAta or mint)
    // and assert Anchor constraints / require! catches it.

    try {
      // TODO: attempt deposit-with-receipt using wrong mint or wrong ata
      expect.fail("expected mismatch to fail");
    } catch (e: any) {
      // expect(errStr(e)).to.include("constraint");
      // or match your ErrorCode (InvalidMint / InvalidTreasuryTokenAccountOwner, etc.)
    }
  });

  // ─────────────────────────────────────────────────────────────
  // C) ACCOUNTING SANITY (DELTA CHECKS)
  // "Token deltas match receipt amount exactly"
  // ─────────────────────────────────────────────────────────────
  it("C1: deposit-with-receipt token deltas exactly equal receipt.amount", async () => {
    const s = await setupBase();

    const userBefore = await getAccount(s.conn, s.userAta.address);
    const treasuryBefore = await getAccount(s.conn, s.treasuryAta.address);

    // ACT: deposit-with-receipt
    // TODO

    const userAfter = await getAccount(s.conn, s.userAta.address);
    const treasuryAfter = await getAccount(s.conn, s.treasuryAta.address);

    // ASSERT deltas (convert bigint safely)
    // expect(Number(userBefore.amount) - Number(userAfter.amount)).to.eq(AMOUNT.toNumber());
    // expect(Number(treasuryAfter.amount) - Number(treasuryBefore.amount)).to.eq(AMOUNT.toNumber());
  });

  it("C2: withdraw-with-receipt token deltas exactly equal receipt.amount", async () => {
    const s = await setupBase();

    // PREP: deposit enough first
    // TODO

    const userBefore = await getAccount(s.conn, s.userAta.address);
    const treasuryBefore = await getAccount(s.conn, s.treasuryAta.address);

    // ACT: withdraw-with-receipt
    // TODO

    const userAfter = await getAccount(s.conn, s.userAta.address);
    const treasuryAfter = await getAccount(s.conn, s.treasuryAta.address);

    // ASSERT deltas match
  });

  // ─────────────────────────────────────────────────────────────
  // D) PAUSE INVARIANTS (OPTIONAL)
  // "Paused means no state side-effects + no receipts"
  // ─────────────────────────────────────────────────────────────
  it("D1: when paused, deposit-with-receipt fails and does not create receipt", async () => {
    const s = await setupBase();

    // Pause treasury (authority)
    anchor.setProvider(s.authProvider);
    await s.programAuth.methods
      .setTreasuryPaused(true)
      .accounts({
        treasury: s.treasuryPda,
        treasuryAuthority: s.protocolAuth.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([s.protocolAuth])
      .rpc();

    // Back to user provider
    anchor.setProvider(userProvider);

    try {
      // ACT: attempt deposit-with-receipt
      // TODO
      expect.fail("expected paused deposit-with-receipt to fail");
    } catch (e: any) {
      expect(errStr(e)).to.include("paused");
    }

    // ASSERT: receipt PDA should NOT exist
    // TODO: derive PDA for the expected receipt and confirm getAccountInfo == null

    // Unpause for cleanliness
    anchor.setProvider(s.authProvider);
    await s.programAuth.methods
      .setTreasuryPaused(false)
      .accounts({
        treasury: s.treasuryPda,
        treasuryAuthority: s.protocolAuth.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([s.protocolAuth])
      .rpc();

    anchor.setProvider(userProvider);
  });
});

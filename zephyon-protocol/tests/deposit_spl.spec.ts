import * as anchor from "@coral-xyz/anchor";
import { deriveTreasuryPda, loadProtocolAuthority, airdrop } from "./_helpers";
import { Program } from "@coral-xyz/anchor";
import { Protocol } from "../target/types/protocol";


import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";


import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
function toNum(v: any): number {
  if (v instanceof anchor.BN) return v.toNumber();
  if (v?.toNumber) return v.toNumber();
  return Number(v);
}


describe("protocol - spl deposit", () => {
  const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program = anchor.workspace.Protocol as Program<Protocol>;
const payer = (provider.wallet as any).payer as anchor.web3.Keypair;


  async function accountExists(
    conn: anchor.web3.Connection,
    pubkey: anchor.web3.PublicKey
  ) {
    const info = await conn.getAccountInfo(pubkey);
    return info !== null;
  }

  it("blocks splDeposit while paused AND prevents treasury ATA creation", async () => {
    // Canonical PDA derivation (single source of truth)
    const [treasuryPda] = deriveTreasuryPda();

    // Load the REAL protocol authority (same as treasury_pause.spec.ts)
    const protocolAuth = loadProtocolAuthority();
    await airdrop(provider, protocolAuth.publicKey, 2);

    // Authority provider context
    const authProvider = new anchor.AnchorProvider(
      provider.connection,
      new anchor.Wallet(protocolAuth),
      provider.opts
    );

    // ─────────────────────────────────────────────
    // 1) Ensure treasury exists under AUTHORITY context
    // ─────────────────────────────────────────────
    anchor.setProvider(authProvider);
    const programAuth = anchor.workspace.Protocol as any;

    try {
      await programAuth.methods
        .initializeTreasury()
        .accounts({
          authority: protocolAuth.publicKey,
          treasury: treasuryPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([protocolAuth])
        .rpc();
    } catch {
      // already exists
    }

    // Pause treasury as authority (this MUST match set_treasury_paused.rs guard)
    await programAuth.methods
      .setTreasuryPaused(true)
      .accounts({
        treasury: treasuryPda,
        treasuryAuthority: protocolAuth.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([protocolAuth])
      .rpc();

    // ─────────────────────────────────────────────
    // 2) Switch back to USER context for deposit attempt
    // ─────────────────────────────────────────────
    anchor.setProvider(provider);
    const programUser = anchor.workspace.Protocol as any;

    // Create a user and mint, but DO NOT create treasury ATA
    const user = Keypair.generate();

    const sig = await provider.connection.requestAirdrop(
      user.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");

    const mint = await createMint(
      provider.connection,
      user, // payer
      user.publicKey, // mint authority
      null,
      6
    );

    const userAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user, // payer
      mint,
      user.publicKey
    );

    // Mint tokens to user
    const depositAmount = 1_000_000;
    await mintTo(
      provider.connection,
      user, // payer
      mint,
      userAta.address,
      user.publicKey, // authority
      depositAmount
    );

    // Derive (but do not create) treasury ATA
    const treasuryAta = await getAssociatedTokenAddress(
      mint,
      treasuryPda,
      true // allowOwnerOffCurve for PDA owners
    );

    const existedBefore = await accountExists(provider.connection, treasuryAta);
    if (existedBefore) {
      throw new Error("Treasury ATA already existed unexpectedly (armor test)");
    }

    // Attempt deposit (should fail)
    let failed = false;
    try {
      await programUser.methods
        .splDeposit(new BN(1))
        .accounts({
          user: user.publicKey,
          treasury: treasuryPda,
          mint,
          userAta: userAta.address,
          treasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([user])
        .rpc();
    } catch {
      failed = true;
    }

    if (!failed) throw new Error("Deposit unexpectedly succeeded while paused");

    const existedAfter = await accountExists(provider.connection, treasuryAta);
    if (existedAfter) {
      throw new Error(
        "Armor failure: treasury ATA was created even though protocol was paused"
      );
    }

    // ─────────────────────────────────────────────
    // 3) Unpause (AUTHORITY) so rest of suite is unaffected
    // ─────────────────────────────────────────────
    anchor.setProvider(authProvider);

    await programAuth.methods
      .setTreasuryPaused(false)
      .accounts({
        treasury: treasuryPda,
        treasuryAuthority: protocolAuth.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([protocolAuth])
      .rpc();

    // Back to user provider (clean exit)
    anchor.setProvider(provider);
  });

  it("deposits SPL from user ATA to treasury ATA", async () => {
    // ─────────────────────────────────────────────
    // 0) Prove what we're bound to (debug truth)
    // ─────────────────────────────────────────────
    console.log("PROGRAM ID:", program.programId.toBase58());
    console.log(
      "IDL instruction names:",
      program.idl.instructions.map((i: any) => i.name)
    );

    const ix = program.idl.instructions.find((i: any) => i.name === "splDeposit");
    if (!ix) throw new Error("IDL missing instruction: splDeposit");

    console.log("splDeposit required accounts:");
    console.log(ix.accounts.map((a: any) => a.name));

    // ─────────────────────────────────────────────
    // 1) Ensure treasury PDA exists (init once)
    // ─────────────────────────────────────────────
    const [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );

    try {
      await program.methods
        .initializeTreasury()
        .accounts({
          authority: provider.wallet.publicKey,
          treasury: treasuryPda,
          systemProgram: SystemProgram.programId,
        }as any)
        .rpc();
      console.log("Treasury initialized:", treasuryPda.toBase58());
    } catch {
      console.log("Treasury init skipped (likely already exists).");
    }

    // ─────────────────────────────────────────────
    // 2) Setup: user + mint + ATAs + balances
    // ─────────────────────────────────────────────
    const user = Keypair.generate();

    const sig = await provider.connection.requestAirdrop(
      user.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");

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
      treasuryPda,
      true
    );

    const depositAmount = 1_000_000;
    await mintTo(
      provider.connection,
      user,
      mint,
      userAta.address,
      user.publicKey,
      depositAmount
    );

    const userBefore = await getAccount(provider.connection, userAta.address);
    const treasuryBefore = await getAccount(
      provider.connection,
      treasuryAta.address
    );

    console.log("User ATA before:", Number(userBefore.amount));
    console.log("Treasury ATA before:", Number(treasuryBefore.amount));

    // ─────────────────────────────────────────────
    // 3) Call splDeposit
    // ─────────────────────────────────────────────
    const tx = await program.methods
      .splDeposit(new BN(depositAmount))
      .accounts({
        user: user.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: userAta.address,
        treasuryAta: treasuryAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      }as any)
      .signers([user])
      .rpc();

    console.log("tx:", tx);

    // ─────────────────────────────────────────────
    // 4) Assert balances changed correctly (minimal)
    // ─────────────────────────────────────────────
    const userAfter = await getAccount(provider.connection, userAta.address);
    const treasuryAfter = await getAccount(
      provider.connection,
      treasuryAta.address
    );

    console.log("User ATA after:", Number(userAfter.amount));
    console.log("Treasury ATA after:", Number(treasuryAfter.amount));

    if (Number(userAfter.amount) !== Number(userBefore.amount) - depositAmount) {
      throw new Error("User balance did not decrease by depositAmount");
    }
    if (
      Number(treasuryAfter.amount) !==
      Number(treasuryBefore.amount) + depositAmount
    ) {
      throw new Error("Treasury balance did not increase by depositAmount");
    }
  });
 it("Core27) emits DepositEvent semantics for splDeposit (direction + assetKind)", async () => {
  // --- Treasury PDA
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId
  );

  // --- Ensure treasury initialized with protocol authority (not wallet payer)
  const protocolAuth = loadProtocolAuthority();
  await airdrop(provider, protocolAuth.publicKey, 2);

  try {
    await program.methods
      .initializeTreasury()
      .accounts({
        authority: protocolAuth.publicKey,
        treasury: treasuryPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([protocolAuth])
      .rpc();
  } catch {
    // already exists
  }

  // --- Create a fresh user (clean + deterministic)
  const user = Keypair.generate();
  const sig = await provider.connection.requestAirdrop(
    user.publicKey,
    2 * anchor.web3.LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig, "confirmed");

  // --- Mint + ATAs
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

  const treasuryAtaAddr = await getAssociatedTokenAddress(mint, treasuryPda, true);

  // Ensure treasury ATA exists (keeps test deterministic)
  await getOrCreateAssociatedTokenAccount(
    provider.connection,
    user,
    mint,
    treasuryPda,
    true
  );

  // --- Seed user funds
  const amount = 1_000_000;
  await mintTo(
    provider.connection,
    user,
    mint,
    userAta.address,
    user.publicKey,
    amount
  );

  // --- Execute splDeposit and CAPTURE signature
  const txSig = await program.methods
    .splDeposit(new BN(amount))
    .accounts({
      user: user.publicKey,
      treasury: treasuryPda,
      mint,
      userAta: userAta.address,
      treasuryAta: treasuryAtaAddr,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any)
    .signers([user])
    .rpc();

  await provider.connection.confirmTransaction(txSig, "confirmed");

  // --- Pull transaction logs
  const tx = await provider.connection.getTransaction(txSig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  } as any);

  if (!tx) throw new Error("Core27: getTransaction returned null (even after confirm)");

  const logs = tx.meta?.logMessages ?? [];

  // --- Canonical Anchor event parsing
  const parser = new anchor.EventParser(program.programId, program.coder);
  const events: any[] = [];
  for (const evt of parser.parseLogs(logs)) events.push(evt);

 const depEvt = events.find((e) => {
  const name = String(e?.name ?? "").toLowerCase();
  return name === "spldepositevent" || name === "depositevent";
});

if (!depEvt) {
  const names = events.map((e) => e?.name).filter(Boolean);
  throw new Error(`Core27: deposit event not found. Events seen: ${names.join(", ")}`);
}

const event: any = depEvt.data;
console.log("Core27 event keys:", Object.keys(event));
console.log("Core27 raw event:", event);


// tolerate snake_case vs camelCase vs alt field names
const assetKind = event.assetKind ?? event.asset_kind;
const direction = event.direction ?? event.payDirection ?? event.pay_direction;

expect(assetKind, "assetKind missing").to.exist;
expect(direction, "direction missing").to.exist;

// semantics
expect(assetKind).to.have.property("spl");
expect(direction).to.have.property("userToTreasury");


// sanity fields (these should exist)
expect(event.user.toBase58()).to.eq(user.publicKey.toBase58());      // use your local user, not payer
expect(event.treasury.toBase58()).to.eq(treasuryPda.toBase58());
expect(event.mint.toBase58()).to.eq(mint.toBase58());
expect(toNum(event.amount)).to.eq(amount);
});
  
});





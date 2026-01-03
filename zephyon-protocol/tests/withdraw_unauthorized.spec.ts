import anchorPkg from "@coral-xyz/anchor";
const anchor = anchorPkg as typeof import("@coral-xyz/anchor");

import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import BN from "bn.js";

import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("protocol - spl withdraw unauthorized", () => {
  const DEBUG = false;
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as any;

  it("rejects withdraw when signer is not treasuryAuthority", async () => {
    // ─────────────────────────────────────────────
    // 0) Attacker (unauthorized signer)
    // ─────────────────────────────────────────────
    const attacker = anchor.web3.Keypair.generate();

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        attacker.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    console.log("PROGRAM ID:", program.programId.toBase58());
    console.log(
      "IDL instruction names:",
      program.idl.instructions.map((i: any) => i.name)
    );

    // Anchor IDL camelCases instruction names
    const ix = program.idl.instructions.find((i: any) => i.name === "splWithdraw");
    if (!ix) throw new Error("IDL missing instruction: splWithdraw");

    console.log("splWithdraw required accounts:");
    console.log(ix.accounts.map((a: any) => a.name));

    // ─────────────────────────────────────────────
    // 1) Treasury PDA (init once, idempotent)
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
        })
        .rpc();
      console.log("Treasury initialized:", treasuryPda.toBase58());
    } catch (_e: any) {
      console.log("Treasury init skipped (likely already exists).");
    }

    // ─────────────────────────────────────────────
    // 2) Setup: user + mint + ATAs
    // ─────────────────────────────────────────────
    const user = Keypair.generate();

    // fund user with SOL for fees (ATA creation)
    const airdropSig = await provider.connection.requestAirdrop(
      user.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig, "confirmed");

    // create mint (user is mint authority)
    const mint = await createMint(
      provider.connection,
      user, // payer
      user.publicKey, // mint authority
      null, // freeze authority
      6 // decimals
    );

    // user ATA (owned by user)
    const userAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user, // payer
      mint,
      user.publicKey
    );

    // treasury ATA (owned by PDA, allow off-curve)
    const treasuryAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user, // payer
      mint,
      treasuryPda,
      true
    );

    // ─────────────────────────────────────────────
    // 3) Put funds in treasury ATA so withdraw has something to move
    // ─────────────────────────────────────────────
    const amount = 1_000_000; // 1.0 token if decimals=6

    // mint tokens directly into treasury ATA (so withdraw has liquidity)
    await mintTo(
      provider.connection,
      user, // payer
      mint,
      treasuryAta.address,
      user.publicKey, // mint authority
      amount
    );

    const userBefore = await getAccount(provider.connection, userAta.address);
    const treasuryBefore = await getAccount(provider.connection, treasuryAta.address);

    if (DEBUG) {
      console.log(
        "IDL instruction names:",
        program.idl.instructions.map((i: any) => i.name)
      );
    }

    if (DEBUG) {
      console.log("splWithdraw required accounts:");
      console.log(ix.accounts.map((a: any) => a.name));
    }



    // ─────────────────────────────────────────────
    // 4) Unauthorized withdraw attempt (must FAIL)
    // ─────────────────────────────────────────────
    let threw = false;

    try {
      const sig = await program.methods
        .splWithdraw(new BN(amount))
        .accounts({
          user: user.publicKey,
          treasury: treasuryPda,

          // wrong authority on purpose
          treasuryAuthority: attacker.publicKey,

          mint,
          userAta: userAta.address,
          treasuryAta: treasuryAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([attacker]) // attacker signs (wrong signer)
        .rpc();

      console.log("ERROR: unauthorized withdraw unexpectedly succeeded. tx:", sig);
    } catch (e: any) {
    threw = true;

    const msg = e?.toString?.() ?? String(e);
    console.log("Expected failure (unauthorized):", msg);

    // Strong assertion: ensure it's the correct failure
    if (!msg.includes("UnauthorizedWithdraw") && !msg.includes("Error Number: 6001")) {
    throw new Error("Withdraw failed, but not for UnauthorizedWithdraw / 6001. Got:\n" + msg);
    }
  }


    if (!threw) {
      throw new Error("Unauthorized withdraw should have failed, but it succeeded.");
    }

    // ─────────────────────────────────────────────
    // 5) Post-condition: balances should be unchanged
    // ─────────────────────────────────────────────
    const userAfter = await getAccount(provider.connection, userAta.address);
    const treasuryAfter = await getAccount(provider.connection, treasuryAta.address);

    console.log("User ATA after:", Number(userAfter.amount));
    console.log("Treasury ATA after:", Number(treasuryAfter.amount));

    if (Number(userAfter.amount) !== Number(userBefore.amount)) {
      throw new Error("User ATA changed after unauthorized withdraw (should be unchanged)");
    }

    if (Number(treasuryAfter.amount) !== Number(treasuryBefore.amount)) {
      throw new Error(
        "Treasury ATA changed after unauthorized withdraw (should be unchanged)"
      );
    }
  });
});


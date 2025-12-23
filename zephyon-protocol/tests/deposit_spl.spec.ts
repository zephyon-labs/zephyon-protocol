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



describe("protocol - spl deposit", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Keep it generic, but anchored to your workspace program.
  const program = anchor.workspace.Protocol as any;



  it("deposits SPL from user ATA to treasury ATA", async () => {
    // ─────────────────────────────────────────────
    // 0) Prove what we're bound to (debug truth)
    // ─────────────────────────────────────────────
    console.log("PROGRAM ID:", program.programId.toBase58());
    console.log(
      "IDL instruction names:",
      program.idl.instructions.map((i) => i.name)
    );

    // Anchor IDL camelCases instruction names
    const ix = program.idl.instructions.find((i) => i.name === "depositSpl");
    if (!ix) throw new Error("IDL missing instruction: depositSpl");

    console.log("depositSpl required accounts:");
    console.log(ix.accounts.map((a) => a.name));

    // ─────────────────────────────────────────────
    // 1) Ensure treasury PDA exists (init once)
    // ─────────────────────────────────────────────
    const [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );

    // Try initialize treasury. If it already exists, that's fine.
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
    } catch (e: any) {
      console.log("Treasury init skipped (likely already exists).");
      // Optional: uncomment if you want to see the full error.
      // console.log(e);
    }

    // ─────────────────────────────────────────────
    // 2) Setup: user + mint + ATAs + balances
    // ─────────────────────────────────────────────
    const user = Keypair.generate();

    // fund user with SOL for fees (they pay for init_if_needed ATA creation)
    const sig = await provider.connection.requestAirdrop(
      user.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");

    // create mint (user is mint authority)
    const mint = await createMint(
      provider.connection,
      user, // payer
      user.publicKey, // mint authority
      null, // freeze authority
      6 // decimals
    );

    // user ATA
    const userAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user, // payer
      mint,
      user.publicKey
    );

    // treasury ATA (owned by PDA, so allowOwnerOffCurve = true)
    const treasuryAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user, // payer
      mint,
      treasuryPda, // owner (PDA)
      true // allow owner off curve
    );

    // mint tokens to user
    const depositAmount = 1_000_000; // 1.0 token if decimals=6
    await mintTo(
      provider.connection,
      user, // payer
      mint,
      userAta.address,
      user.publicKey, // authority
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
    // 3) Call depositSpl
    // ─────────────────────────────────────────────
    const tx = await program.methods
      .depositSpl(new BN(depositAmount))



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
      })
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

    // Minimal invariant checks without chai
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
});

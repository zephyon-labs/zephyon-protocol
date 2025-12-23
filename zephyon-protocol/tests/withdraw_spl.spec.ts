import anchorPkg from "@coral-xyz/anchor";
const anchor = anchorPkg as typeof import("@coral-xyz/anchor");

import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import BN from "bn.js";

import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";

describe("protocol - spl withdraw", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as any;

  it("withdraws SPL from treasury ATA to user ATA", async () => {
    console.log("PROGRAM ID:", program.programId.toBase58());
    console.log(
      "IDL instruction names:",
      program.idl.instructions.map((i) => i.name)
    );

    const ix = program.idl.instructions.find((i) => i.name === "withdrawSpl");
    if (!ix) throw new Error("IDL missing instruction: withdrawSpl");

    console.log("withdrawSpl required accounts:");
    console.log(ix.accounts.map((a) => a.name));

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
    } catch (e: any) {
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

    console.log("User ATA before:", Number(userBefore.amount));
    console.log("Treasury ATA before:", Number(treasuryBefore.amount));

    // ─────────────────────────────────────────────
    // 4) Withdraw: treasury -> user
    // ─────────────────────────────────────────────
    const sig = await program.methods
      .withdrawSpl(new BN(amount))
      .accounts({
        user: user.publicKey,
        treasury: treasuryPda,
        mint,
        user_ata: userAta.address,
        treasury_ata: treasuryAta.address,
        token_program: anchor.utils.token.TOKEN_PROGRAM_ID,
        associated_token_program: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        system_program: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    console.log("tx:", sig);

    const userAfter = await getAccount(provider.connection, userAta.address);
    const treasuryAfter = await getAccount(provider.connection, treasuryAta.address);

    console.log("User ATA after:", Number(userAfter.amount));
    console.log("Treasury ATA after:", Number(treasuryAfter.amount));

    // ─────────────────────────────────────────────
    // 5) Assertions
    // ─────────────────────────────────────────────
    if (Number(userAfter.amount) !== Number(userBefore.amount) + amount) {
      throw new Error("User ATA did not increase by expected amount");
    }
    if (Number(treasuryAfter.amount) !== Number(treasuryBefore.amount) - amount) {
      throw new Error("Treasury ATA did not decrease by expected amount");
    }
  });
});

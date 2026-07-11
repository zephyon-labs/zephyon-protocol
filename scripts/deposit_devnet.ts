import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idl from "../target/idl/protocol.json" with { type: "json" };

const PROGRAM_ID = new PublicKey(
  "BtP7rVw9sqN4pW5RuzZJ2c4576R5pJU9yRtjrRJ7b5bM"
);

const TREASURY_PDA = new PublicKey(
  "CuqGCfnkHN5APYdL2UkCMYbVxXxqKrwrmWXw24WeQDbE"
);

const DEPOSIT_AMOUNT = 1_000_000; // 1.000000 tokens at 6 decimals

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const ctorArity = (Program as any).length;
  let program: any;

  if (ctorArity >= 3) {
    program = new (Program as any)(idl, PROGRAM_ID, provider);
  } else {
    const idlWithMetadata = {
      ...(idl as any),
      metadata: {
        ...((idl as any).metadata ?? {}),
        address: PROGRAM_ID.toBase58(),
      },
    };
    program = new (Program as any)(idlWithMetadata, provider);
  }

  const payer = (provider.wallet as any).payer;

  console.log("Provider wallet:", provider.wallet.publicKey.toBase58());
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Treasury PDA:", TREASURY_PDA.toBase58());

  // B1: create a fresh devnet mint
  const mint = await createMint(
    provider.connection,
    payer,
    provider.wallet.publicKey,
    null,
    6,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );

  console.log("Mint:", mint.toBase58());

  // B2: create user ATA + mint tokens to it
  const userAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    mint,
    provider.wallet.publicKey,
    false,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  await mintTo(
    provider.connection,
    payer,
    mint,
    userAta.address,
    provider.wallet.publicKey,
    DEPOSIT_AMOUNT,
    [],
    undefined,
    TOKEN_PROGRAM_ID
  );

  console.log("User ATA:", userAta.address.toBase58());

  // B3: derive treasury ATA for this mint
  const treasuryAta = getAssociatedTokenAddressSync(
    mint,
    TREASURY_PDA,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log("Treasury ATA:", treasuryAta.toBase58());

  const userBefore = await getAccount(provider.connection, userAta.address).catch(() => null);
  const treasuryBefore = await getAccount(provider.connection, treasuryAta).catch(() => null);

  console.log("User ATA before:", userBefore ? userBefore.amount.toString() : "missing");
  console.log("Treasury ATA before:", treasuryBefore ? treasuryBefore.amount.toString() : "missing");

  // B4: call Zephyon splDeposit
  const tx = await program.methods
    .splDeposit(new BN(DEPOSIT_AMOUNT))
    .accounts({
      user: provider.wallet.publicKey,
      treasury: TREASURY_PDA,
      mint,
      userAta: userAta.address,
      treasuryAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  console.log("Deposit TX:", tx);

  // B5: verify balances after
  const userAfter = await getAccount(provider.connection, userAta.address);
  const treasuryAfter = await getAccount(provider.connection, treasuryAta);

  console.log("User ATA after:", userAfter.amount.toString());
  console.log("Treasury ATA after:", treasuryAfter.amount.toString());
}

main().catch((err) => {
  console.error("deposit_devnet failed:");
  console.error(err);
  process.exit(1);
});
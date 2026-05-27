import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  Connection,
  clusterApiUrl,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import fs from "node:fs";
import path from "node:path";

const idlPath = path.resolve(__dirname, "../target/idl/protocol.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

const PROGRAM_ID = new PublicKey(
  "BtP7rVw9sqN4pW5RuzZJ2c4576R5pJU9yRtjrRJ7b5bM"
);

const keypairPath = process.env.HOME + "/.config/solana/id.json";
const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

// Usage:
// npx ts-node-esm typescript/devnet/pay_devnet.ts <MINT_PUBKEY> <RECIPIENT_PUBKEY> <AMOUNT_RAW>
const mintArg = process.argv[2];
const recipientArg = process.argv[3];
const amountArg = process.argv[4];

if (!mintArg || !recipientArg || !amountArg) {
  console.error(
    "Usage: npx ts-node-esm typescript/devnet/pay_devnet.ts <MINT_PUBKEY> <RECIPIENT_PUBKEY> <AMOUNT_RAW>"
  );
  process.exit(1);
}

const MINT = new PublicKey(mintArg);
const RECIPIENT = new PublicKey(recipientArg);
const AMOUNT_RAW = Number(amountArg);

if (!Number.isFinite(AMOUNT_RAW) || AMOUNT_RAW <= 0 || !Number.isInteger(AMOUNT_RAW)) {
  console.error("Amount must be a positive raw integer.");
  process.exit(1);
}

function deriveTreasuryPda(programId: PublicKey): PublicKey {
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    programId
  );
  return treasuryPda;
}

async function loadProgram(connection: Connection, walletKp: Keypair) {
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKp),
    {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    }
  );

  anchor.setProvider(provider);

  const idlWithMeta = {
    ...(idl as any),
    metadata: {
      ...((idl as any).metadata ?? {}),
      address: PROGRAM_ID.toBase58(),
    },
  };

  const program = new anchor.Program(idlWithMeta as any, provider);
  return { provider, program };
}

async function main() {
  console.log("=== Zephyon Devnet SPL Pay ===\n");
  console.log("Wallet:", payer.publicKey.toBase58());
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Mint:", MINT.toBase58());
  console.log("Recipient:", RECIPIENT.toBase58());
  console.log("Amount (raw):", AMOUNT_RAW);

  const { provider, program } = await loadProgram(connection, payer);
  const programAny = program as any;
  const TREASURY_PDA = deriveTreasuryPda(PROGRAM_ID);

  console.log("Treasury PDA:", TREASURY_PDA.toBase58());

  const treasury = await programAny.account.treasury.fetch(TREASURY_PDA);

  console.log("Paused:", treasury.paused);
  console.log("Pay Count (before):", treasury.payCount.toString());

  if (treasury.paused) {
    throw new Error("Treasury is paused. Unpause before running pay_devnet.ts");
  }

  const treasuryAta = getAssociatedTokenAddressSync(
    MINT,
    TREASURY_PDA,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const recipientAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    MINT,
    RECIPIENT,
    false,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const payCountBefore = new BN(treasury.payCount.toString());

  const [receiptPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("receipt"),
      TREASURY_PDA.toBuffer(),
      payCountBefore.toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  );

  console.log("Treasury ATA:", treasuryAta.toBase58());
  console.log("Recipient ATA:", recipientAta.address.toBase58());
  console.log("Expected receipt PDA:", receiptPda.toBase58());

  const treasuryBefore = await getAccount(
    provider.connection,
    treasuryAta,
    "confirmed",
    TOKEN_PROGRAM_ID
  );
  const recipientBefore = await getAccount(
    provider.connection,
    recipientAta.address,
    "confirmed",
    TOKEN_PROGRAM_ID
  );

  console.log("\n--- Balances Before ---");
  console.log("Treasury ATA before:", treasuryBefore.amount.toString());
  console.log("Recipient ATA before:", recipientBefore.amount.toString());

  const tx = await programAny.methods
    .splPay(new BN(AMOUNT_RAW), null, null)
    .accounts({
      treasuryAuthority: provider.wallet.publicKey,
      treasury: TREASURY_PDA,
      mint: MINT,
      treasuryAta,
      recipient: RECIPIENT,
      recipientAta: recipientAta.address,
      receipt: receiptPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  console.log("\nPay TX:", tx);

  const treasuryAfter = await getAccount(
    provider.connection,
    treasuryAta,
    "confirmed",
    TOKEN_PROGRAM_ID
  );
  const recipientAfter = await getAccount(
    provider.connection,
    recipientAta.address,
    "confirmed",
    TOKEN_PROGRAM_ID
  );

  const treasuryAfterState = await programAny.account.treasury.fetch(TREASURY_PDA);

  console.log("\n--- Balances After ---");
  console.log("Treasury ATA after:", treasuryAfter.amount.toString());
  console.log("Recipient ATA after:", recipientAfter.amount.toString());
  console.log("Pay Count (after):", treasuryAfterState.payCount.toString());

  console.log("\n--- Deltas ---");
  console.log(
    "Treasury delta:",
    (
      BigInt(treasuryBefore.amount.toString()) -
      BigInt(treasuryAfter.amount.toString())
    ).toString()
  );
  console.log(
    "Recipient delta:",
    (
      BigInt(recipientAfter.amount.toString()) -
      BigInt(recipientBefore.amount.toString())
    ).toString()
  );
  const result = {
  success: true,
  tx,
  receiptPda: receiptPda.toBase58(),
  treasury: TREASURY_PDA.toBase58(),
  mint: MINT.toBase58(),
  recipient: RECIPIENT.toBase58(),
  amountRaw: AMOUNT_RAW,
  payCountBefore: payCountBefore.toString(),
  payCountAfter: treasuryAfterState.payCount.toString(),
};

console.log("\n--- JSON_RESULT ---");
console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error("pay_devnet failed:");
  console.error(err);
  process.exit(1);
});
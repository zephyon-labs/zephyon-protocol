import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import fs from "fs";
import os from "os";
import path from "path";

// --- helpers ---

function loadKeypairFromFile(filePath: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  // 1. Connect + load wallet
  const payer = loadKeypairFromFile(
    path.join(os.homedir(), ".config", "solana", "id.json")
  );

  const connection = new Connection("https://api.devnet.solana.com", {
    commitment: "confirmed",
  });

  console.log("🔌 devnet connection ok");

  // 2. Program info
  const PROGRAM_ID = new PublicKey(
    "4u849yEmC4oRkBE2HcMCTYxuZuazPiqueps7XkCk16qx"
  );

  // 3. We'll create the state account ourselves.
  //
  // According to the IDL:
  //   accounts:
  //    - state (writable, signer)
  //    - signer (writable, signer)
  //    - system_program
  //
  // And the struct has:
  //   ProtocolState { value: u64 }
  //
  // Anchor accounts usually start with an 8-byte discriminator.
  // So we'll allocate 16 bytes total (8 discriminator + 8 u64).
  //
  const stateKp = Keypair.generate();
  const stateSpace = 16; // bytes
  const rentLamports = await connection.getMinimumBalanceForRentExemption(
    stateSpace
  );

  console.log("📝 allocating state account with rent lamports:", rentLamports);

  // 4. Build instruction #1: create the state account
  const createIx = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: stateKp.publicKey,
    lamports: rentLamports,
    space: stateSpace,
    programId: PROGRAM_ID, // owned by our program
  });

  // 5. We need to build instruction #2: call `initialize(data: u64)`
  //
  // To do that, we have to manually encode the instruction data the way Anchor expects.
  // Anchor does:
  //   8-byte instruction discriminator
  //   followed by args
  //
  // From your IDL:
  //   "initialize" discriminator bytes are:
  //   [175,175,109,31,13,152,155,237]
  //
  // Arg is `data: u64`. We'll pick 999n for dramatic effect.
  //
  const ixDiscriminator = Uint8Array.from([
    175, 175, 109, 31, 13, 152, 155, 237,
  ]);

  function u64LE(value: number) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}


  const dataArg = u64LE(999);

  const ixData = Buffer.concat([Buffer.from(ixDiscriminator), dataArg]);

  // Accounts (in order) must match the IDL:
  // state (writable, signer)
  // signer (writable, signer)
  // system_program
  //
  const initializeIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: stateKp.publicKey, isSigner: true, isWritable: true },
      { pubkey: payer.publicKey,   isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: ixData,
  });

  // 6. Bundle both instructions into one tx:
  // - create account (stateKp signs + payer signs)
  // - call initialize (stateKp signs + payer signs)
  //
  const tx = new Transaction().add(createIx, initializeIx);

  console.log("🚀 sending transaction...");
  const sig = await sendAndConfirmTransaction(connection, tx, [
    payer,
    stateKp,
  ]);

  console.log("✅ success!");
  console.log("   tx signature:", sig);
  console.log("   state account:", stateKp.publicKey.toBase58());
}

main().catch((err) => {
  console.error("❌ Error running devnet initialize:", err);
});


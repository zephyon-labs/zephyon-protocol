import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import fs from "fs";
import os from "os";
import path from "path";

/**
 * Devnet program ID for Zephyon Protocol.
 */
const PROGRAM_ID = new PublicKey(
  "4u849yEmC4oRkBE2HcMCTYxuZuazPiqueps7XkCk16qx"
);

/**
 * Load the payer keypair (your deploy wallet).
 */
function loadKeypairFromFile(filePath: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

const DEFAULT_KEYPAIR_PATH = path.join(
  os.homedir(),
  ".config",
  "solana",
  "id.json"
);

// We’ll persist the state account so we can read it later.
const STATE_DUMP_PATH = path.join(
  process.cwd(),
  "sdk",
  "ts",
  "last_state_keypair.json"
);

export async function rawInitializeCall() {
  // 1. Connect to devnet
  const connection = new Connection("https://api.devnet.solana.com", {
    commitment: "confirmed",
  });

  // 2. Load signer (payer)
  const payer = loadKeypairFromFile(DEFAULT_KEYPAIR_PATH);

  // 3. Generate a new account for ProtocolState
  const stateKp = Keypair.generate();

  // Save it so we can read it later
  fs.writeFileSync(
    STATE_DUMP_PATH,
    JSON.stringify(Array.from(stateKp.secretKey), null, 2),
    { encoding: "utf8" }
  );

  // 4. Build instruction data (8-byte discriminator + 8-byte u64 arg)
  const discriminator = Uint8Array.from([
    175, 175, 109, 31, 13, 152, 155, 237,
  ]);

  // what we’re storing in ProtocolState.value
  const dataValue = 42n;

  const ixData = Buffer.alloc(16);
  Buffer.from(discriminator).copy(ixData, 0);
  ixData.writeBigUInt64LE(dataValue, 8);

  // 5. Account metas (mirrors your #[derive(Accounts)] Initialize)
  const keys = [
    {
      pubkey: stateKp.publicKey,
      isWritable: true,
      isSigner: true,
    },
    {
      pubkey: payer.publicKey,
      isWritable: true,
      isSigner: true,
    },
    {
      pubkey: SystemProgram.programId,
      isWritable: false,
      isSigner: false,
    },
  ];

  // 6. Transaction
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data: ixData,
  });

  const tx = new Transaction().add(ix);

  // 7. Send
  const sig = await sendAndConfirmTransaction(
    connection,
    tx,
    [payer, stateKp],
    { commitment: "confirmed" }
  );

  console.log("rawInitializeCall tx sig:", sig);
  console.log("state account pubkey:", stateKp.publicKey.toBase58());
  console.log("state keypair saved to:", STATE_DUMP_PATH);
}

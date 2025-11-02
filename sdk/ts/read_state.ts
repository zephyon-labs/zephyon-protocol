import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import fs from "fs";
import path from "path";

/**
 * This must match your Rust struct:
 *
 * #[account]
 * pub struct ProtocolState {
 *     pub value: u64,
 * }
 *
 * Anchor account layout:
 *  - 8 bytes: account discriminator
 *  - 8 bytes: value (u64 LE)
 */

const STATE_DUMP_PATH = path.join(
  process.cwd(),
  "sdk",
  "ts",
  "last_state_keypair.json"
);

async function main() {
  // 1. Connect to devnet.
  const connection = new Connection("https://api.devnet.solana.com", {
    commitment: "confirmed",
  });

  // 2. Recreate the same state keypair you used in initialize.
  const secret = JSON.parse(
    fs.readFileSync(STATE_DUMP_PATH, "utf8")
  );
  const stateKp = Keypair.fromSecretKey(
    Uint8Array.from(secret)
  );

  const statePubkey = stateKp.publicKey;
  console.log("Reading state account:", statePubkey.toBase58());

  // 3. Fetch its raw account data from chain.
  const acctInfo = await connection.getAccountInfo(statePubkey);
  if (!acctInfo) {
    console.error("Account not found on devnet (no data).");
    return;
  }

  const data = acctInfo.data;
  // data layout:
  // [0..8)   = Anchor account discriminator
  // [8..16)  = value: u64 little-endian

  if (data.length < 16) {
    console.error("Account data too short:", data.length);
    return;
  }

  // decode little-endian u64 at bytes 8..16
  const valueBytes = data.subarray(8, 16);
  const value =
    valueBytes[0] +
    (valueBytes[1] << 8) +
    (valueBytes[2] << 16) +
    (valueBytes[3] << 24) +
    (Number(valueBytes[4]) * 2 ** 32) +
    (Number(valueBytes[5]) * 2 ** 40) +
    (Number(valueBytes[6]) * 2 ** 48) +
    (Number(valueBytes[7]) * 2 ** 56);

  console.log("ProtocolState.value =", value);
}

main().catch((err) => {
  console.error("read_state error:", err);
});

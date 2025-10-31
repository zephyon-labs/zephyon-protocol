
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, Idl, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * PROGRAM + NETWORK CONFIG
 * ----------------------------------------------------------------
 * This is the address of the live Zephyon Protocol program
 * currently deployed on Solana devnet.
 */
const PROGRAM_ID = new PublicKey(
  "4u849yEmC4oRkBE2HcMCTYxuZuazPiqueps7XkCk16qx"
);

/**
 * Load a local keypair (your devnet wallet).
 * By default Anchor used ~/.config/solana/id.json when deploying.
 *
 * If you ever switch to a different signer, just update this path.
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

/**
 * Build an AnchorProvider using:
 * - your local devnet wallet
 * - a confirmed devnet connection
 */
export function getProvider(): AnchorProvider {
  const payer = loadKeypairFromFile(DEFAULT_KEYPAIR_PATH);

  const connection = new Connection("https://api.devnet.solana.com", {
    commitment: "confirmed",
  });

  // Minimal wallet wrapper so AnchorProvider is happy
  const wallet: Wallet = {
    publicKey: payer.publicKey,
    signTransaction: async (tx) => {
      tx.partialSign(payer);
      return tx;
    },
    signAllTransactions: async (txs) => {
      txs.forEach((tx) => tx.partialSign(payer));
      return txs;
    },
  };

  return new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
}

/**
 * Create an Anchor Program client using the generated IDL at:
 * target/idl/zephyon_protocol.json
 */
export function getProgram(): Program {
  const provider = getProvider();

  // This assumes you're running this file from repo root.
  // If you run it from inside sdk/ts directly with ts-node,
  // you may need to adjust this relative path.
  const idlPath = path.join(
    process.cwd(),
    "target",
    "idl",
    "zephyon_protocol.json"
  );

  const rawIdl = fs.readFileSync(idlPath, "utf8");
  const idl = JSON.parse(rawIdl) as Idl;

  return new Program(idl, PROGRAM_ID, provider);
}

/**
 * initializeExample()
 *
 * This is a scaffold for calling your on-chain `initialize`
 * instruction defined in the IDL.
 *
 * According to the IDL snippet:
 *   accounts:
 *     - state   (writable, signer)
 *     - signer  (writable, signer)
 *     - system_program
 *   args:
 *     - data
 *
 * We are *guessing* `state` is a brand new account you create and own.
 * If instead it's a PDA, we’ll switch this to PDA derivation next.
 */
export async function initializeExample() {
  const program = getProgram();
  const provider = program.provider as AnchorProvider;

  // We'll create a brand new account to act as `state`.
  // This matches the IDL: `state` must be writable + signer.
  const stateKp = Keypair.generate();

  // This is the first value we want to store on-chain.
  // It must be a u64, so we'll pass a normal JS number and Anchor
  // will BN-encode it under the hood if the IDL says "u64".
  const initialValue = 42; // <- You can change this later.

  const txSig = await program.methods
    .initialize(new anchor.BN(initialValue))
    .accounts({
      state: stateKp.publicKey,
      signer: provider.wallet.publicKey,
      systemProgram: new PublicKey(
        "11111111111111111111111111111111"
      ),
    })
    .signers([stateKp]) // state account is also a signer per IDL
    .rpc();

  console.log("initialize tx signature:", txSig);
  console.log("state account public key:", stateKp.publicKey.toBase58());
}


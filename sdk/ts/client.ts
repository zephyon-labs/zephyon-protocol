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

  // We'll make a brand new account to act as `state`.
  // If your program expects a PDA instead, we'll update this later.
  const stateKp = Keypair.generate();

  // TODO: Update this `data` argument once we inspect full IDL args.
  // For now we'll leave it as a placeholder.
  // e.g. .initialize(new BN(123)) or .initialize({ value: new BN(1) }) etc.
  const txSig = await program.methods
    // @ts-expect-error placeholder until we know the actual arg shape
    .initialize(/* data goes here */)
    .accounts({
      state: stateKp.publicKey,
      signer: provider.wallet.publicKey,
      systemProgram: new PublicKey(
        "11111111111111111111111111111111"
      ),
    })
    .signers([stateKp]) // provider wallet signs automatically too
    .rpc();

  console.log("initialize tx signature:", txSig);
}

/**
 * If you want to run this directly with ts-node later:
 *
 *   import { initializeExample } from "./client";
 *   initializeExample().catch(console.error);
 *
 * That will try to send the initialize transaction to devnet.
 */

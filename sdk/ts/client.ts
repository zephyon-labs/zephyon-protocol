import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import {
  AnchorProvider,
  Program,
  BN,
  Idl,
} from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * PROGRAM + NETWORK CONFIG
 * ----------------------------------------------------------------
 * Your live Zephyon Protocol program on Solana devnet.
 */
const PROGRAM_ID = new PublicKey(
  "4u849yEmC4oRkBE2HcMCTYxuZuazPiqueps7XkCk16qx"
);

/**
 * Load your local devnet wallet keypair (the same signer Anchor used).
 *
 * SECURITY NOTE:
 * We read this locally. We NEVER commit or paste its contents.
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
 * Build an AnchorProvider:
 * - devnet RPC connection
 * - NodeWallet wrapping your payer Keypair
 * - confirmed commitment level
 */
export function getProvider(): AnchorProvider {
  const payer = loadKeypairFromFile(DEFAULT_KEYPAIR_PATH);

  const connection = new Connection("https://api.devnet.solana.com", {
    commitment: "confirmed",
  });

  const wallet = new NodeWallet(payer);

  return new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
}

/**
 * Load the IDL Anchor generated for your deployed program.
 */

function loadIdl(): Idl {
  const idlPath = path.join(
    process.cwd(),
    "target",
    "idl",
    "zephyon_protocol.json"
  );
  const rawIdl = fs.readFileSync(idlPath, "utf8");

  // Parse the IDL Anchor generated for our program
  const idl = JSON.parse(rawIdl) as any;

  // Some early IDLs (like ours) don't include a top-level `accounts` array.
  // Anchor's Program(...) builder assumes it's always there and crashes if not.
  // So we normalize it.
  if (!idl.accounts) {
    idl.accounts = [];
  }

  return idl as Idl;
}


/**
 * Get a Program client for Zephyon Protocol.
 *
 * Anchor 0.32.x has messy TS signatures for Program(...) across builds.
 * We're going to assert the types directly so TS stops blocking you.
 *
 * Runtime is what matters — not pleasing the linter.
 */
export function getProgram(): Program {
  const provider = getProvider();
  const idl = loadIdl();

  // Force-cast to line up with the runtime signature:
  // new Program(idl, programId, provider?)
  const program = new Program(
    idl as any,
    PROGRAM_ID as any,
    provider as any
  ) as Program;

  return program;
}

/**
 * initializeExample()
 *
 * TRY to call your `initialize` instruction on devnet.
 *
 * From the IDL snippet:
 *   accounts:
 *     - state   (writable, signer)
 *     - signer  (writable, signer)
 *     - system_program
 *   args:
 *     - data
 *
 * We *don't yet know*:
 *  - what the "data" arg should look like,
 *  - whether `state` is supposed to be a PDA instead of a random Keypair,
 *  - what size `state` should be allocated.
 *
 * So we:
 *   - generate a new state keypair
 *   - pass dummy data = BN(1)
 *   - try to send
 *
 * Whatever error we get back is GOOD. It will literally tell us
 * how to shape the real call.
 */
export async function initializeExample() {
  const program = getProgram();
  const provider = program.provider as AnchorProvider;

  // We'll guess state is just an owned account for now.
  const stateKp = Keypair.generate();

  const dummyData = new BN(1);

  try {
    const txSig = await program.methods
      .initialize(dummyData)
      .accounts({
        state: stateKp.publicKey,
        signer: provider.wallet.publicKey,
        systemProgram: new PublicKey(
          "11111111111111111111111111111111"
        ),
      })
      .signers([stateKp])
      .rpc();

    console.log("initialize tx signature:", txSig);
  } catch (err) {
    console.error("initializeExample() failed:", err);
    throw err;
  }
}


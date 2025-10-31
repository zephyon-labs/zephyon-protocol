import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

describe("zephyon_protocol devnet smoke test", () => {
  // Load the same wallet Anchor used to deploy
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

  const payer = loadKeypairFromFile(DEFAULT_KEYPAIR_PATH);

  // Connect provider to devnet, not localnet
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    { commitment: "confirmed" }
  );

  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  anchor.setProvider(provider);

  // Load IDL from local file
  const idlRaw = fs.readFileSync(
    path.join(process.cwd(), "target", "idl", "zephyon_protocol.json"),
    "utf8"
  );
  const idl = JSON.parse(idlRaw);

  const PROGRAM_ID = new PublicKey(
    "4u849yEmC4oRkBE2HcMCTYxuZuazPiqueps7XkCk16qx"
  );

  const program = new anchor.Program(idl, PROGRAM_ID, provider);

  it("calls initialize on devnet", async () => {
    // state account must be writable+signer (per IDL)
    const stateKp = Keypair.generate();

    // pick some u64 data to write
    const initialValue = new anchor.BN(777);

    const txSig = await program.methods
      .initialize(initialValue)
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
    console.log("state account:", stateKp.publicKey.toBase58());
  });
});

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import idl from "../target/idl/protocol.json";

const PROGRAM_ID = new PublicKey(
  "BtP7rVw9sqN4pW5RuzZJ2c4576R5pJU9yRtjrRJ7b5bM"
);

const TREASURY_PDA = new PublicKey(
  "CuqGCfnkHN5APYdL2UkCMYbVxXxqKrwrmWXw24WeQDbE"
);

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

  console.log("Provider wallet:", provider.wallet.publicKey.toBase58());
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Treasury PDA:", TREASURY_PDA.toBase58());

  const method = program.methods.setTreasuryPaused(false);
  const tx = await method
    .accounts({
      treasury: TREASURY_PDA,
      treasuryAuthority: provider.wallet.publicKey,
    })
    .rpc();

  console.log("Unpause Treasury TX:", tx);
}

main().catch((err) => {
  console.error("unpause_devnet failed:");
  console.error(err);
  process.exit(1);
});
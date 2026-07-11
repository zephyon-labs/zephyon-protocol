import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import idl from "../target/idl/protocol.json";

const PROGRAM_ID = new PublicKey(
  "BtP7rVw9sqN4pW5RuzZJ2c4576R5pJU9yRtjrRJ7b5bM"
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

  const [treasury] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    PROGRAM_ID
  );

  console.log("Provider wallet:", provider.wallet.publicKey.toBase58());
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Treasury PDA:", treasury.toBase58());

  const method = program.methods.initializeTreasury();
  const tx = await method
    .accounts({
      treasury,
      treasuryAuthority: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("Initialize Treasury TX:", tx);
}

main().catch((err) => {
  console.error("init_treasury_devnet failed:");
  console.error(err);
  process.exit(1);
});
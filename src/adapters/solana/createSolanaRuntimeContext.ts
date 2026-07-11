import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
} from "@solana/web3.js";

export type SolanaRuntimeContext = {
  connection: Connection;
  provider: anchor.AnchorProvider;
  wallet: Keypair;
  program: anchor.Program;
};

export type CreateSolanaRuntimeContextInput = {
  connection: Connection;
  wallet: Keypair;
  programId: string;
  idl: unknown;
};

export function createSolanaRuntimeContext(
  input: CreateSolanaRuntimeContextInput,
): SolanaRuntimeContext {
  const provider = new anchor.AnchorProvider(
    input.connection,
    new anchor.Wallet(input.wallet),
    {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    },
  );

  anchor.setProvider(provider);

  const idlWithMetadata = {
    ...(input.idl as any),
    metadata: {
      ...((input.idl as any).metadata ?? {}),
      address: input.programId,
    },
  };

  const program = new anchor.Program(
    idlWithMetadata as any,
    provider,
  );

  return {
    connection: input.connection,
    provider,
    wallet: input.wallet,
    program,
  };
}
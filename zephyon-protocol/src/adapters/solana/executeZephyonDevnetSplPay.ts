import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  Connection,
  clusterApiUrl,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import fs from "node:fs";
import path from "node:path";
import type {
  SolanaTransferRequest,
  SolanaTransferResult,
} from "./SolanaPaymentAdapter";

const PROGRAM_ID = new PublicKey(
  "BtP7rVw9sqN4pW5RuzZJ2c4576R5pJU9yRtjrRJ7b5bM",
);

export type ExecuteZephyonDevnetSplPayConfig = {
  rpcUrl?: string;
  keypairPath?: string;
  idlPath?: string;
};

export async function executeZephyonDevnetSplPay(
  request: SolanaTransferRequest,
  config: ExecuteZephyonDevnetSplPayConfig = {},
): Promise<SolanaTransferResult> {
  const rpcUrl = config.rpcUrl ?? clusterApiUrl("devnet");
  const keypairPath =
    config.keypairPath ?? `${process.env.HOME}/.config/solana/id.json`;
  const idlPath = config.idlPath ?? path.resolve(process.cwd(), "target/idl/protocol.json");

  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  const connection = new Connection(rpcUrl, "confirmed");
  const { provider, program } = loadProgram(connection, payer, idl);
  const programAny = program as any;

  const mint = new PublicKey(request.intent.mint);
  const recipient = new PublicKey(request.intent.recipientWallet);
  const amountRaw = request.intent.amountRaw;

  if (
    !Number.isFinite(amountRaw) ||
    amountRaw <= 0 ||
    !Number.isInteger(amountRaw)
  ) {
    throw new Error("Amount must be a positive raw integer.");
  }

  const treasuryPda = deriveTreasuryPda(PROGRAM_ID);
  const treasury = await programAny.account.treasury.fetch(treasuryPda);

  if (treasury.paused) {
    throw new Error("Treasury is paused.");
  }

  const treasuryAta = getAssociatedTokenAddressSync(
    mint,
    treasuryPda,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const recipientAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    mint,
    recipient,
    false,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const payCountBefore = new BN(treasury.payCount.toString());

  const [receiptPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("receipt"),
      treasuryPda.toBuffer(),
      payCountBefore.toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID,
  );

  const blockhash = await provider.connection.getLatestBlockhash("confirmed");

  const signature = await programAny.methods
    .splPay(new BN(amountRaw), null, null)
    .accounts({
      treasuryAuthority: provider.wallet.publicKey,
      treasury: treasuryPda,
      mint,
      treasuryAta,
      recipient,
      recipientAta: recipientAta.address,
      receipt: receiptPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  const status = await provider.connection.getSignatureStatus(signature, {
    searchTransactionHistory: true,
  });

  return {
    signature,
    submittedAt: new Date().toISOString(),
    slot: status.value?.slot,
    blockhash: blockhash.blockhash,
  };
}

function deriveTreasuryPda(programId: PublicKey): PublicKey {
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    programId,
  );

  return treasuryPda;
}

function loadProgram(
  connection: Connection,
  walletKp: Keypair,
  idl: unknown,
): {
  provider: anchor.AnchorProvider;
  program: anchor.Program;
} {
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKp),
    {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    },
  );

  anchor.setProvider(provider);

  const idlWithMeta = {
    ...(idl as any),
    metadata: {
      ...((idl as any).metadata ?? {}),
      address: PROGRAM_ID.toBase58(),
    },
  };

  const program = new anchor.Program(idlWithMeta as any, provider);

  return { provider, program };
}
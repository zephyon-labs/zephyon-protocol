import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import fs from "node:fs";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  getAccount,
} from "@solana/spl-token";

import type { ProtocolEnvironment } from "./config";
import { buildSplPayInstruction } from "./paymentInstructionBuilder";

export type PaymentSimulationRequest = {
  mint: string;
  recipient: string;
  amountRaw: number;
};

export type PaymentSimulationStatus =
  | "simulated"
  | "blocked"
  | "failed";

export type PaymentSimulationResult = {
  status: PaymentSimulationStatus;
  environment: string;
  mint: string;
  recipient: string;
  amountRaw: number;
  treasuryPda?: string;
  treasuryAta?: string;
  recipientAta?: string;
  receiptPda?: string;
  simulated: boolean;
  err: unknown;
  logs: string[];
  unitsConsumed?: number;
  checkedAt: string;
  errors: string[];
};

export async function simulateSplPayment(
  environment: ProtocolEnvironment,
  request: PaymentSimulationRequest
): Promise<PaymentSimulationResult> {
  const errors: string[] = [];

  if (!environment.treasuryPda) {
    return blocked(environment, request, [
      "Treasury PDA is not configured.",
    ]);
  }

  const connection = new Connection(environment.rpcEndpoint.url, "confirmed");

  const payer = loadDefaultKeypair();
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(payer),
    {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    }
  );

  anchor.setProvider(provider);

  const programId = new PublicKey(environment.programId);
  const treasuryPda = new PublicKey(environment.treasuryPda);
  const mint = new PublicKey(request.mint);
  const recipient = new PublicKey(request.recipient);

  const program = loadProgram(provider, programId);

  const programAny = program as any;
  const treasury = await programAny.account.treasury.fetch(treasuryPda);
  const payCountBefore = new BN(treasury.payCount.toString());

  const built = await buildSplPayInstruction({
    program: programAny,
    programId,
    treasuryPda,
    treasuryAuthority: provider.wallet.publicKey,
    mint,
    recipient,
    amountRaw: request.amountRaw,
    payCountBefore,
  });

  try {
    await getAccount(
      connection,
      built.treasuryAta,
      "confirmed"
    );
  } catch {
    errors.push("Treasury ATA does not exist for this mint.");
  }

  try {
    await getAccount(
      connection,
      built.recipientAta,
      "confirmed"
    );
  } catch {
    errors.push("Recipient ATA does not exist for this mint.");
  }

  if (errors.length > 0) {
    return {
      status: "blocked",
      environment: environment.name,
      mint: request.mint,
      recipient: request.recipient,
      amountRaw: request.amountRaw,
      treasuryPda: treasuryPda.toBase58(),
      treasuryAta: built.treasuryAta.toBase58(),
      recipientAta: built.recipientAta.toBase58(),
      receiptPda: built.receiptPda.toBase58(),
      simulated: false,
      err: null,
      logs: [],
      checkedAt: new Date().toISOString(),
      errors,
    };
  }

  const transaction = new Transaction().add(built.instruction);
  transaction.feePayer = provider.wallet.publicKey;

  const latestBlockhash = await connection.getLatestBlockhash();
  transaction.recentBlockhash = latestBlockhash.blockhash;

  transaction.sign(payer);

  const simulation = await connection.simulateTransaction(transaction);

  return {
    status: simulation.value.err ? "failed" : "simulated",
    environment: environment.name,
    mint: request.mint,
    recipient: request.recipient,
    amountRaw: request.amountRaw,
    treasuryPda: treasuryPda.toBase58(),
    treasuryAta: built.treasuryAta.toBase58(),
    recipientAta: built.recipientAta.toBase58(),
    receiptPda: built.receiptPda.toBase58(),
    simulated: true,
    err: simulation.value.err,
    logs: simulation.value.logs ?? [],
    unitsConsumed: simulation.value.unitsConsumed ?? undefined,
    checkedAt: new Date().toISOString(),
    errors: [],
  };
}

function loadDefaultKeypair(): Keypair {
  const keypairPath = process.env.HOME + "/.config/solana/id.json";
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function loadProgram(
  provider: anchor.AnchorProvider,
  programId: PublicKey
): anchor.Program {
  const idlPath = path.resolve(process.cwd(), "target/idl/protocol.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

  const idlWithMeta = {
    ...(idl as any),
    metadata: {
      ...((idl as any).metadata ?? {}),
      address: programId.toBase58(),
    },
  };

  return new anchor.Program(idlWithMeta as any, provider);
}

function blocked(
  environment: ProtocolEnvironment,
  request: PaymentSimulationRequest,
  errors: string[]
): PaymentSimulationResult {
  return {
    status: "blocked",
    environment: environment.name,
    mint: request.mint,
    recipient: request.recipient,
    amountRaw: request.amountRaw,
    simulated: false,
    err: null,
    logs: [],
    checkedAt: new Date().toISOString(),
    errors,
  };
}
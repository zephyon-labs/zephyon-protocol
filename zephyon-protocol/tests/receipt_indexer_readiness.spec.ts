import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  expect,
  initFoundationOnce,
  setupMintAndAtas,
  deriveDepositReceiptPda,
  getAccountInfoOrNull,
  decodeReceiptFromAccountInfo,
  airdrop,
} from "./_helpers";

function bn(x: number | string | bigint) {
  return new anchor.BN(x.toString());
}

function getIx(program: Program<any>, name: string): any {
  const ix = (program.idl.instructions as any[]).find((i) => i.name === name);
  if (!ix) throw new Error(`IDL instruction not found: ${name}`);
  return ix;
}

function accMetaFromIdl(acc: any) {
  const isSigner = !!acc.isSigner;
  const isWritable = !!acc.isMut || !!acc.isWritable || !!acc.writable || false;
  return { isSigner, isWritable };
}

async function sendRawTxFresh(args: {
  provider: AnchorProvider;
  tx: Transaction;
  signers: Keypair[];
  commitment?: anchor.web3.Commitment;
}): Promise<string> {
  const {
    provider,
    tx,
    signers,
    commitment = "finalized",
  } = args;

  const feePayer = signers[0]?.publicKey ?? (provider.wallet as any).publicKey;
  tx.feePayer = feePayer;

  const latest = await provider.connection.getLatestBlockhash("finalized");
  tx.recentBlockhash = latest.blockhash;
  tx.sign(...signers);

  const sig = await provider.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "finalized",
    maxRetries: 3,
  });

  await provider.connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    commitment
  );

  const statusResp = await provider.connection.getSignatureStatuses([sig]);
  const status = statusResp.value[0];

  if (!status) {
    throw new Error(`sendRawTxFresh: missing signature status for ${sig}`);
  }

  if (status.err) {
    throw new Error(
      `sendRawTxFresh: transaction failed: ${JSON.stringify(status.err)}`
    );
  }

  return sig;
}

async function buildSplDepositWithReceiptTx(args: {
  program: Program<any>;
  user: Keypair;
  treasuryPda: PublicKey;
  mint: PublicKey;
  userAta: PublicKey;
  treasuryAta: PublicKey;
  receipt: PublicKey;
  amount: bigint;
  nonce: bigint;
}): Promise<Transaction> {
  const {
    program,
    user,
    treasuryPda,
    mint,
    userAta,
    treasuryAta,
    receipt,
    amount,
    nonce,
  } = args;

  const ixDef = getIx(program, "splDepositWithReceipt");

  const full: Record<string, PublicKey> = {
    user: user.publicKey,
    treasury: treasuryPda,
    mint,
    userAta,
    treasuryAta,
    receipt,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  };

  const argsObj: any = {};
  for (const a of ixDef.args as any[]) {
    const lower = String(a.name).toLowerCase();
    if (lower === "amount") argsObj[a.name] = bn(amount);
    else if (lower === "nonce") argsObj[a.name] = bn(nonce);
    else argsObj[a.name] = null;
  }

  const data = program.coder.instruction.encode("splDepositWithReceipt", argsObj);

  const keys = (ixDef.accounts as any[]).map((acc: any) => {
    const pubkey = full[acc.name];
    if (!pubkey) {
      throw new Error(
        `Missing account '${acc.name}' for splDepositWithReceipt. Provided: ${Object.keys(full).join(", ")}`
      );
    }
    const { isSigner, isWritable } = accMetaFromIdl(acc);
    return { pubkey, isSigner, isWritable };
  });

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys,
    data,
  });

  return new Transaction().add(ix);
}

describe("protocol - receipt indexer readiness (Core15.2)", function () {
  this.timeout(3_600_000);

  const envProvider = anchor.AnchorProvider.env();
  const provider = new AnchorProvider(
    envProvider.connection,
    envProvider.wallet,
    {
      commitment: "finalized",
      preflightCommitment: "finalized",
      skipPreflight: false,
    }
  );
  anchor.setProvider(provider);

  let program: Program<any>;

  before(() => {
    // @ts-ignore
    const wsProgram = anchor.workspace.Protocol as Program<any>;
    const ctorArity = (Program as any).length;

    if (ctorArity >= 3) {
      program = new (Program as any)(wsProgram.idl, wsProgram.programId, provider);
    } else {
      const idl = wsProgram.idl as any;
      idl.metadata = {
        ...(idl.metadata ?? {}),
        address: wsProgram.programId.toBase58(),
      };
      program = new (Program as any)(idl, provider);
    }
  });

  it("A) indexer-style: raw getAccountInfo + decode yields correct receipt fields", async () => {
    const payer = Keypair.generate();
    await airdrop(provider, payer.publicKey, 2, "finalized");

    const { treasuryPda } = await initFoundationOnce(provider, program);
    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      payer,
      treasuryPda,
      1_000_000n
    );

    const amount = 1234n;
    const nonce = 999n;

    const [receiptPda] = deriveDepositReceiptPda(
      program.programId,
      payer.publicKey,
      Number(nonce)
    );

    const tx = await buildSplDepositWithReceiptTx({
      program,
      user: payer,
      treasuryPda,
      mint,
      userAta,
      treasuryAta,
      receipt: receiptPda,
      amount,
      nonce,
    });

    await sendRawTxFresh({
      provider,
      tx,
      signers: [payer],
      commitment: "finalized",
    });

    const info = await getAccountInfoOrNull(provider, receiptPda);
    expect(info).to.not.eq(null);

    const decoded = decodeReceiptFromAccountInfo(program, info!);

    expect(decoded.user.equals(payer.publicKey)).to.eq(true);
    expect(decoded.mint.equals(mint)).to.eq(true);
    expect(Number(decoded.amount)).to.eq(Number(amount));
    expect(Number(decoded.txCount)).to.eq(Number(nonce));
  });

  it("B) indexer-style: non-existent receipt PDA returns null", async () => {
    const user = Keypair.generate();

    const [phantomReceiptPda] = deriveDepositReceiptPda(
      program.programId,
      user.publicKey,
      424242
    );

    const info = await getAccountInfoOrNull(provider, phantomReceiptPda);
    expect(info).to.eq(null);
  });
});

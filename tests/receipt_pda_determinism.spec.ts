import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  expect,
  initFoundationOnce,
  setupMintAndAtas,
  deriveDepositReceiptPda,
  deriveWithdrawReceiptPda,
  deriveUserProfilePda,
  airdrop,
  loadProtocolAuthority,
} from "./_helpers";

function bn(x: number | bigint | string) {
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

async function buildSplDepositTx(args: {
  program: Program<any>;
  user: Keypair;
  treasuryPda: PublicKey;
  mint: PublicKey;
  userAta: PublicKey;
  treasuryAta: PublicKey;
  amount: bigint;
}): Promise<Transaction> {
  const { program, user, treasuryPda, mint, userAta, treasuryAta, amount } = args;

  const ixDef = getIx(program, "splDeposit");

  const full: Record<string, PublicKey> = {
    user: user.publicKey,
    treasury: treasuryPda,
    mint,
    userAta,
    treasuryAta,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  };

  const argsObj: any = {};
  for (const a of ixDef.args as any[]) {
    const lower = String(a.name).toLowerCase();
    if (lower === "amount") argsObj[a.name] = bn(amount);
    else argsObj[a.name] = null;
  }

  const data = program.coder.instruction.encode("splDeposit", argsObj);

  const keys = (ixDef.accounts as any[]).map((acc: any) => {
    const pubkey = full[acc.name];
    if (!pubkey) {
      throw new Error(
        `Missing account '${acc.name}' for splDeposit. Provided: ${Object.keys(full).join(", ")}`
      );
    }
    const { isSigner, isWritable } = accMetaFromIdl(acc);
    return { pubkey, isSigner, isWritable };
  });

  return new Transaction().add(
    new TransactionInstruction({
      programId: program.programId,
      keys,
      data,
    })
  );
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

  return new Transaction().add(
    new TransactionInstruction({
      programId: program.programId,
      keys,
      data,
    })
  );
}

async function buildSplWithdrawWithReceiptTx(args: {
  program: Program<any>;
  user: Keypair;
  treasuryAuthority: Keypair;
  userProfile: PublicKey;
  treasuryPda: PublicKey;
  mint: PublicKey;
  userAta: PublicKey;
  treasuryAta: PublicKey;
  receipt: PublicKey;
  amount: bigint;
}): Promise<Transaction> {
  const {
    program,
    user,
    treasuryAuthority,
    userProfile,
    treasuryPda,
    mint,
    userAta,
    treasuryAta,
    receipt,
    amount,
  } = args;

  const ixDef = getIx(program, "splWithdrawWithReceipt");

  const full: Record<string, PublicKey> = {
    user: user.publicKey,
    treasuryAuthority: treasuryAuthority.publicKey,
    userProfile,
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
    else argsObj[a.name] = null;
  }

  const data = program.coder.instruction.encode("splWithdrawWithReceipt", argsObj);

  const keys = (ixDef.accounts as any[]).map((acc: any) => {
    const pubkey = full[acc.name];
    if (!pubkey) {
      throw new Error(
        `Missing account '${acc.name}' for splWithdrawWithReceipt. Provided: ${Object.keys(full).join(", ")}`
      );
    }
    const { isSigner, isWritable } = accMetaFromIdl(acc);
    return { pubkey, isSigner, isWritable };
  });

  return new Transaction().add(
    new TransactionInstruction({
      programId: program.programId,
      keys,
      data,
    })
  );
}

describe("protocol - receipt PDA determinism (Core15.1)", function () {
  this.timeout(3_600_000);

  let provider: AnchorProvider;
  let program: Program<any>;
  let protocolAuth: Keypair;

  before(async () => {
    const envProvider = anchor.AnchorProvider.env();
    protocolAuth = loadProtocolAuthority();

    provider = new AnchorProvider(
      envProvider.connection,
      new anchor.Wallet(protocolAuth),
      {
        commitment: "finalized",
        preflightCommitment: "finalized",
        skipPreflight: false,
      }
    );
    anchor.setProvider(provider);

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

    await airdrop(provider, protocolAuth.publicKey, 2, "finalized");
  });

  it("A) deposit-with-receipt: created receipt address matches derived PDA (user + nonce)", async () => {
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
    const nonce = 777n;

    const [expectedReceiptPda] = deriveDepositReceiptPda(
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
      receipt: expectedReceiptPda,
      amount,
      nonce,
    });

    await sendRawTxFresh({
      provider,
      tx,
      signers: [payer],
      commitment: "finalized",
    });

    const receipt = await (program.account as any).receipt.fetch(expectedReceiptPda);

    expect(receipt.user.equals(payer.publicKey)).to.eq(true);
    expect(receipt.mint.equals(mint)).to.eq(true);
    expect(Number(receipt.amount)).to.eq(Number(amount));
    expect(Number(receipt.txCount)).to.eq(Number(nonce));
  });

  it("B) withdraw-with-receipt: created receipt address matches derived PDA (user + txCountBefore)", async () => {
    const payer = Keypair.generate();
    await airdrop(provider, payer.publicKey, 2, "finalized");

    const { treasuryPda } = await initFoundationOnce(provider, program);
    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      payer,
      treasuryPda,
      1_000_000n
    );

    const depositTx = await buildSplDepositTx({
      program,
      user: payer,
      treasuryPda,
      mint,
      userAta,
      treasuryAta,
      amount: 1000n,
    });

    await sendRawTxFresh({
      provider,
      tx: depositTx,
      signers: [payer],
      commitment: "finalized",
    });

    const [userProfilePda] = deriveUserProfilePda(payer.publicKey);

    let txCountBefore = 0;
    try {
      const up = await (program.account as any).userProfile.fetch(userProfilePda);
      txCountBefore = Number(up.txCount);
    } catch {
      txCountBefore = 0;
    }

    const [expectedReceiptPda] = deriveWithdrawReceiptPda(
      program.programId,
      payer.publicKey,
      txCountBefore
    );

    const amount = 500n;

    const withdrawTx = await buildSplWithdrawWithReceiptTx({
      program,
      user: payer,
      treasuryAuthority: protocolAuth,
      userProfile: userProfilePda,
      treasuryPda,
      mint,
      userAta,
      treasuryAta,
      receipt: expectedReceiptPda,
      amount,
    });

    await sendRawTxFresh({
      provider,
      tx: withdrawTx,
      signers: [payer, protocolAuth],
      commitment: "finalized",
    });

    const receipt = await (program.account as any).receipt.fetch(expectedReceiptPda);

    expect(receipt.user.equals(payer.publicKey)).to.eq(true);
    expect(receipt.mint.equals(mint)).to.eq(true);
    expect(Number(receipt.amount)).to.eq(Number(amount));
    expect(Number(receipt.txCount)).to.eq(txCountBefore);
  });
});

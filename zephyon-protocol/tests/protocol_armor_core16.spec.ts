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
  airdrop,
  loadProtocolAuthority,
  deriveUserProfilePda,
  deriveWithdrawReceiptPda,
  PROGRAM_ID,
} from "./_helpers";

function bn(x: number | bigint | string) {
  return new anchor.BN(x.toString());
}

async function expectFail(p: Promise<any>) {
  let failed = false;
  try {
    await p;
  } catch {
    failed = true;
  }
  expect(failed).to.eq(true);
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

async function buildSetTreasuryPausedTx(args: {
  program: Program<any>;
  authority: Keypair;
  treasuryPda: PublicKey;
  paused: boolean;
}): Promise<Transaction> {
  const { program, authority, treasuryPda, paused } = args;

  const ixDef = getIx(program, "setTreasuryPaused");

  const full: Record<string, PublicKey> = {
    treasuryAuthority: authority.publicKey,
    treasury: treasuryPda,
    systemProgram: SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  };

  const data = program.coder.instruction.encode("setTreasuryPaused", { paused });

  const keys = (ixDef.accounts as any[]).map((acc: any) => {
    const pubkey = full[acc.name];
    if (!pubkey) {
      throw new Error(
        `Missing account '${acc.name}' for setTreasuryPaused. Provided: ${Object.keys(
          full
        ).join(", ")}`
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
        `Missing account '${acc.name}' for splDeposit. Provided: ${Object.keys(full).join(
          ", "
        )}`
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

async function buildSplWithdrawTx(args: {
  program: Program<any>;
  treasuryAuthority: Keypair;
  user: PublicKey;
  treasuryPda: PublicKey;
  mint: PublicKey;
  userAta: PublicKey;
  treasuryAta: PublicKey;
  amount: bigint;
}): Promise<Transaction> {
  const {
    program,
    treasuryAuthority,
    user,
    treasuryPda,
    mint,
    userAta,
    treasuryAta,
    amount,
  } = args;

  const ixDef = getIx(program, "splWithdraw");

  const full: Record<string, PublicKey> = {
    treasuryAuthority: treasuryAuthority.publicKey,
    user,
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

  const data = program.coder.instruction.encode("splWithdraw", argsObj);

  const keys = (ixDef.accounts as any[]).map((acc: any) => {
    const pubkey = full[acc.name];
    if (!pubkey) {
      throw new Error(
        `Missing account '${acc.name}' for splWithdraw. Provided: ${Object.keys(full).join(
          ", "
        )}`
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
        `Missing account '${acc.name}' for splWithdrawWithReceipt. Provided: ${Object.keys(
          full
        ).join(", ")}`
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

describe("protocol armor core16", function () {
  this.timeout(3_600_000);

  let provider: AnchorProvider;
  let program: Program<any>;

  let treasuryPda: PublicKey;
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

    const foundation = await initFoundationOnce(provider, program);
    treasuryPda = foundation.treasuryPda;

    await airdrop(provider, protocolAuth.publicKey, 2, "finalized");

    const unpauseTx = await buildSetTreasuryPausedTx({
      program,
      authority: protocolAuth,
      treasuryPda,
      paused: false,
    });

    await sendRawTxFresh({
      provider,
      tx: unpauseTx,
      signers: [protocolAuth],
      commitment: "finalized",
    });
  });

  async function seedTreasury(amount: bigint) {
    const user = Keypair.generate();
    await airdrop(provider, user.publicKey, 2, "finalized");

    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      user,
      treasuryPda,
      1_000_000n
    );

    const depositTx = await buildSplDepositTx({
      program,
      user,
      treasuryPda,
      mint,
      userAta,
      treasuryAta,
      amount,
    });

    await sendRawTxFresh({
      provider,
      tx: depositTx,
      signers: [user],
      commitment: "finalized",
    });

    return { user, mint, userAta, treasuryAta };
  }

  after(async () => {
    if (!program || !protocolAuth || !treasuryPda) return;

    const tx = await buildSetTreasuryPausedTx({
      program,
      authority: protocolAuth,
      treasuryPda,
      paused: false,
    });

    await sendRawTxFresh({
      provider,
      tx,
      signers: [protocolAuth],
      commitment: "finalized",
    });
  });

  it("A) deposit rejects fake treasury ATA", async () => {
    const user = Keypair.generate();
    await airdrop(provider, user.publicKey, 2, "finalized");

    const { mint, userAta, treasuryAta } = await setupMintAndAtas(
      provider,
      user,
      treasuryPda,
      1_000_000n
    );

    const fakeTreasuryAta = userAta;

    const tx = await buildSplDepositTx({
      program,
      user,
      treasuryPda,
      mint,
      userAta,
      treasuryAta: fakeTreasuryAta,
      amount: 1_000n,
    });

    await expectFail(
      sendRawTxFresh({
        provider,
        tx,
        signers: [user],
        commitment: "finalized",
      })
    );

    void treasuryAta;
  });

  it("B) deposit rejects mismatched user ATA", async () => {
    const user = Keypair.generate();
    const otherUser = Keypair.generate();
    await airdrop(provider, user.publicKey, 2, "finalized");
    await airdrop(provider, otherUser.publicKey, 2, "finalized");

    const { mint, treasuryAta } = await setupMintAndAtas(
      provider,
      user,
      treasuryPda,
      1_000_000n
    );

    const otherSetup = await setupMintAndAtas(
      provider,
      otherUser,
      treasuryPda,
      1_000_000n
    );

    const tx = await buildSplDepositTx({
      program,
      user,
      treasuryPda,
      mint,
      userAta: otherSetup.userAta,
      treasuryAta,
      amount: 1_000n,
    });

    await expectFail(
      sendRawTxFresh({
        provider,
        tx,
        signers: [user],
        commitment: "finalized",
      })
    );
  });

  it("C) withdraw rejects fake treasury ATA", async () => {
    const { user, mint, userAta, treasuryAta } = await seedTreasury(50_000n);

    const fakeTreasuryAta = userAta;

    const tx = await buildSplWithdrawTx({
      program,
      treasuryAuthority: protocolAuth,
      user: user.publicKey,
      treasuryPda,
      mint,
      userAta,
      treasuryAta: fakeTreasuryAta,
      amount: 1_000n,
    });

    await expectFail(
      sendRawTxFresh({
        provider,
        tx,
        signers: [protocolAuth],
        commitment: "finalized",
      })
    );

    void treasuryAta;
  });

  it("D) withdraw rejects mismatched user ATA", async () => {
    const { mint, treasuryAta } = await seedTreasury(50_000n);

    const victim = Keypair.generate();
    const attacker = Keypair.generate();
    await airdrop(provider, victim.publicKey, 2, "finalized");
    await airdrop(provider, attacker.publicKey, 2, "finalized");

    const victimSetup = await setupMintAndAtas(
      provider,
      victim,
      treasuryPda,
      1_000_000n
    );

    const attackerSetup = await setupMintAndAtas(
      provider,
      attacker,
      treasuryPda,
      1_000_000n
    );

    const tx = await buildSplWithdrawTx({
      program,
      treasuryAuthority: protocolAuth,
      user: victim.publicKey,
      treasuryPda,
      mint,
      userAta: attackerSetup.userAta,
      treasuryAta,
      amount: 1_000n,
    });

    await expectFail(
      sendRawTxFresh({
        provider,
        tx,
        signers: [protocolAuth],
        commitment: "finalized",
      })
    );

    void victimSetup;
  });

  it("E) withdraw-with-receipt rejects fake treasury ATA", async () => {
    const { user, mint, userAta, treasuryAta } = await seedTreasury(50_000n);

    const [userProfilePda] = deriveUserProfilePda(user.publicKey);
    const [receiptPda] = deriveWithdrawReceiptPda(PROGRAM_ID(), user.publicKey, 0);

    const fakeTreasuryAta = userAta;

    const tx = await buildSplWithdrawWithReceiptTx({
      program,
      user,
      treasuryAuthority: protocolAuth,
      userProfile: userProfilePda,
      treasuryPda,
      mint,
      userAta,
      treasuryAta: fakeTreasuryAta,
      receipt: receiptPda,
      amount: 1_000n,
    });

    await expectFail(
      sendRawTxFresh({
        provider,
        tx,
        signers: [user, protocolAuth],
        commitment: "finalized",
      })
    );

    void treasuryAta;
  });

  it("F) withdraw-with-receipt rejects spoofed receipt PDA (txCountAfter)", async () => {
    const { user, mint, userAta, treasuryAta } = await seedTreasury(50_000n);

    const [userProfilePda] = deriveUserProfilePda(user.publicKey);

    const profileBefore: any =
      await (program.account as any).userProfile.fetchNullable(userProfilePda);
    const txCountBefore = profileBefore ? Number(profileBefore.txCount) : 0;

    const [spoofedReceiptPda] = deriveWithdrawReceiptPda(
      PROGRAM_ID(),
      user.publicKey,
      txCountBefore + 1
    );

    const tx = await buildSplWithdrawWithReceiptTx({
      program,
      user,
      treasuryAuthority: protocolAuth,
      userProfile: userProfilePda,
      treasuryPda,
      mint,
      userAta,
      treasuryAta,
      receipt: spoofedReceiptPda,
      amount: 1_000n,
    });

    await expectFail(
      sendRawTxFresh({
        provider,
        tx,
        signers: [user, protocolAuth],
        commitment: "finalized",
      })
    );
  });
});



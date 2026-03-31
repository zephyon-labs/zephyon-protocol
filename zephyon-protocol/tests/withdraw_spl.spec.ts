import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { expect } from "chai";
import { Protocol } from "../target/types/protocol";

import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";

import {
  initFoundationOnce,
  setupMintAndAtas,
  loadProtocolAuthority,
  airdrop,
} from "./_helpers";

function bn(x: number | string | bigint) {
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

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys,
    data,
  });

  return new Transaction().add(ix);
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

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys,
    data,
  });

  return new Transaction().add(ix);
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

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys,
    data,
  });

  return new Transaction().add(ix);
}

describe("protocol - spl withdraw", function () {
  this.timeout(3_600_000);

  let provider: AnchorProvider;
  let program: Program<Protocol>;
  let programAny: Program<any>;

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

    programAny = program as Program<any>;

    const foundation = await initFoundationOnce(provider, programAny);
    treasuryPda = foundation.treasuryPda;

    await airdrop(provider, protocolAuth.publicKey, 2, "finalized");

    const t: any = await program.account.treasury.fetch(treasuryPda);
    expect(t.authority.toBase58()).to.eq(protocolAuth.publicKey.toBase58());

    const unpauseTx = await buildSetTreasuryPausedTx({
      program: programAny,
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
    const depositor = Keypair.generate();
    await airdrop(provider, depositor.publicKey, 2, "finalized");

    const setup = await setupMintAndAtas(
      provider,
      depositor,
      treasuryPda,
      amount
    );

    const mint = setup.mint;
    const depositorAta = setup.userAta;
    const treasuryAta = setup.treasuryAta;

    const depositTx = await buildSplDepositTx({
      program: programAny,
      user: depositor,
      treasuryPda,
      mint,
      userAta: depositorAta,
      treasuryAta,
      amount: 900_000n,
    });

    await sendRawTxFresh({
      provider,
      tx: depositTx,
      signers: [depositor],
      commitment: "finalized",
    });

    return { depositor, mint, depositorAta, treasuryAta };
  }

  after(async () => {
    if (!programAny || !protocolAuth || !treasuryPda) return;

    const tx = await buildSetTreasuryPausedTx({
      program: programAny,
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

  it("A) withdraws SPL from treasury ATA to user ATA (authority gated, ATA auto-create)", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const user = Keypair.generate();
    await airdrop(provider, user.publicKey, 1, "finalized");

    const userAta = getAssociatedTokenAddressSync(
      mint,
      user.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const treasuryBefore = await getAccount(
      provider.connection,
      treasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );
    const userInfoBefore = await provider.connection.getAccountInfo(userAta, "finalized");

    const amount = 123_456n;

    const withdrawTx = await buildSplWithdrawTx({
      program: programAny,
      treasuryAuthority: protocolAuth,
      user: user.publicKey,
      treasuryPda,
      mint,
      userAta,
      treasuryAta,
      amount,
    });

    await sendRawTxFresh({
      provider,
      tx: withdrawTx,
      signers: [protocolAuth],
      commitment: "finalized",
    });

    expect(userInfoBefore).to.eq(null);

    const userAfter = await getAccount(
      provider.connection,
      userAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );
    const treasuryAfter = await getAccount(
      provider.connection,
      treasuryAta,
      "finalized",
      TOKEN_PROGRAM_ID
    );

    expect(Number(userAfter.amount)).to.eq(Number(amount));
    expect(Number(treasuryBefore.amount) - Number(treasuryAfter.amount)).to.eq(Number(amount));
  });

  it("B) unauthorized withdraw fails", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const attacker = Keypair.generate();
    await airdrop(provider, attacker.publicKey, 1, "finalized");

    const attackerAta = getAssociatedTokenAddressSync(
      mint,
      attacker.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const withdrawTx = await buildSplWithdrawTx({
      program: programAny,
      treasuryAuthority: attacker,
      user: attacker.publicKey,
      treasuryPda,
      mint,
      userAta: attackerAta,
      treasuryAta,
      amount: 1n,
    });

    await expectFail(
      sendRawTxFresh({
        provider,
        tx: withdrawTx,
        signers: [attacker],
        commitment: "finalized",
      })
    );
  });

  it("C) withdraw fails while paused", async () => {
    const { mint, treasuryAta } = await seedTreasury(1_000_000n);

    const pauseTx = await buildSetTreasuryPausedTx({
      program: programAny,
      authority: protocolAuth,
      treasuryPda,
      paused: true,
    });

    await sendRawTxFresh({
      provider,
      tx: pauseTx,
      signers: [protocolAuth],
      commitment: "finalized",
    });

    try {
      const user = Keypair.generate();
      await airdrop(provider, user.publicKey, 1, "finalized");

      const userAta = getAssociatedTokenAddressSync(
        mint,
        user.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const withdrawTx = await buildSplWithdrawTx({
        program: programAny,
        treasuryAuthority: protocolAuth,
        user: user.publicKey,
        treasuryPda,
        mint,
        userAta,
        treasuryAta,
        amount: 1n,
      });

      await expectFail(
        sendRawTxFresh({
          provider,
          tx: withdrawTx,
          signers: [protocolAuth],
          commitment: "finalized",
        })
      );
    } finally {
      const unpauseTx = await buildSetTreasuryPausedTx({
        program: programAny,
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
    }
  });
});

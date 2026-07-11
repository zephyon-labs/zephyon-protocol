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
  deriveDepositReceiptPda,
  deriveWithdrawReceiptPda,
  getAccountInfoOrNull,
} from "./_helpers";

function bn(x: number | bigint) {
  return new anchor.BN(x.toString());
}

function getIx(program: Program<any>, name: string): any {
  return (program.idl.instructions as any[]).find((i) => i.name === name);
}

function accMetaFromIdl(acc: any) {
  return {
    isSigner: !!acc.isSigner,
    isWritable: !!acc.isMut || !!acc.isWritable || !!acc.writable,
  };
}

async function sendRawTx(provider: AnchorProvider, tx: Transaction, signers: Keypair[]) {
  const latest = await provider.connection.getLatestBlockhash("finalized");
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);

  const sig = await provider.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "finalized",
  });

  await provider.connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "finalized"
  );

  return sig;
}

function buildIx(program: Program<any>, name: string, accounts: any, args: any) {
  const ixDef = getIx(program, name);

  const data = program.coder.instruction.encode(name, args);

  const keys = ixDef.accounts.map((acc: any) => {
    const pubkey = accounts[acc.name];
    if (!pubkey) throw new Error(`Missing account: ${acc.name}`);
    const meta = accMetaFromIdl(acc);
    return { pubkey, ...meta };
  });

  return new TransactionInstruction({
    programId: program.programId,
    keys,
    data,
  });
}

describe("protocol - receipt invariants final (Core15.3)", function () {
  this.timeout(3_600_000);

  const env = anchor.AnchorProvider.env();
  const provider = new AnchorProvider(env.connection, env.wallet, {
    commitment: "finalized",
  });
  anchor.setProvider(provider);

  let program: Program<any>;

  before(() => {
  // @ts-ignore
  const ws = anchor.workspace.Protocol as Program<any>;

  const ctorArity = (Program as any).length;

  if (ctorArity >= 3) {
    program = new (Program as any)(ws.idl, ws.programId, provider);
  } else {
    const idl = ws.idl as any;

    idl.metadata = {
      ...(idl.metadata ?? {}),
      address: ws.programId.toBase58(),
    };

    program = new (Program as any)(idl, provider);
  }
});

  it("F1) deposit-with-receipt: nonce replay must fail", async () => {
    const user = Keypair.generate();
    await airdrop(provider, user.publicKey, 2);

    const { treasuryPda } = await initFoundationOnce(provider, program);
    const { mint, userAta, treasuryAta } =
      await setupMintAndAtas(provider, user, treasuryPda, 1_000_000n);

    const amount = 1000n;
    const nonce = 777;

    const [receiptPda] = deriveDepositReceiptPda(
      program.programId,
      user.publicKey,
      nonce
    );

    const ix = buildIx(program, "splDepositWithReceipt", {
      user: user.publicKey,
      treasury: treasuryPda,
      mint,
      userAta,
      treasuryAta,
      receipt: receiptPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    }, {
      amount: bn(amount),
      nonce: bn(nonce),
    });

    await sendRawTx(provider, new Transaction().add(ix), [user]);

    let threw = false;
    try {
      await sendRawTx(provider, new Transaction().add(ix), [user]);
    } catch {
      threw = true;
    }

    expect(threw).to.eq(true);
  });

  it("F2) deposit receipt cannot be reused by another user", async () => {
    const userA = Keypair.generate();
    const userB = Keypair.generate();

    await airdrop(provider, userA.publicKey, 2);
    await airdrop(provider, userB.publicKey, 2);

    const { treasuryPda } = await initFoundationOnce(provider, program);

    const { mint, userAta: ataA, treasuryAta } =
      await setupMintAndAtas(provider, userA, treasuryPda, 1_000_000n);

    const { userAta: ataB } =
      await setupMintAndAtas(provider, userB, treasuryPda, 1_000_000n);

    const nonce = 888;

    const [receiptPda] = deriveDepositReceiptPda(
      program.programId,
      userA.publicKey,
      nonce
    );

    const ixA = buildIx(program, "splDepositWithReceipt", {
      user: userA.publicKey,
      treasury: treasuryPda,
      mint,
      userAta: ataA,
      treasuryAta,
      receipt: receiptPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    }, {
      amount: bn(500),
      nonce: bn(nonce),
    });

    await sendRawTx(provider, new Transaction().add(ixA), [userA]);

    let threw = false;

    try {
      const ixB = buildIx(program, "splDepositWithReceipt", {
        user: userB.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: ataB,
        treasuryAta,
        receipt: receiptPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      }, {
        amount: bn(500),
        nonce: bn(nonce),
      });

      await sendRawTx(provider, new Transaction().add(ixB), [userB]);
    } catch {
      threw = true;
    }

    expect(threw).to.eq(true);
  });

  it("F3) withdraw receipt uses txCountBefore PDA", async () => {
    const user = Keypair.generate();
    await airdrop(provider, user.publicKey, 2);

    const protocolAuth = loadProtocolAuthority();

    const { treasuryPda } = await initFoundationOnce(provider, program);
    const { mint, userAta, treasuryAta } =
      await setupMintAndAtas(provider, user, treasuryPda, 1_000_000n);

    // deposit first
    const depositIx = buildIx(program, "splDeposit", {
      user: user.publicKey,
      treasury: treasuryPda,
      mint,
      userAta,
      treasuryAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    }, {
      amount: bn(1_000_000),
    });

    await sendRawTx(provider, new Transaction().add(depositIx), [user]);

    const [userProfilePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_profile"), user.publicKey.toBuffer()],
      program.programId
    );

    const profile: any =
      await (program.account as any).userProfile.fetchNullable(userProfilePda);

    const txCountBefore = profile ? Number(profile.txCount) : 0;

    const [expectedReceipt] = deriveWithdrawReceiptPda(
      program.programId,
      user.publicKey,
      txCountBefore
    );

    const [phantomAfter] = deriveWithdrawReceiptPda(
      program.programId,
      user.publicKey,
      txCountBefore + 1
    );

    const withdrawIx = buildIx(program, "splWithdrawWithReceipt", {
      user: user.publicKey,
      treasuryAuthority: protocolAuth.publicKey,
      userProfile: userProfilePda,
      treasury: treasuryPda,
      mint,
      userAta,
      treasuryAta,
      receipt: expectedReceipt,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    }, {
      amount: bn(1000),
    });

    await sendRawTx(
      provider,
      new Transaction().add(withdrawIx),
      [user, protocolAuth]
    );

    const existsExpected = await getAccountInfoOrNull(provider, expectedReceipt);
    expect(existsExpected).to.not.eq(null);

    const existsAfter = await getAccountInfoOrNull(provider, phantomAfter);
    expect(existsAfter).to.eq(null);
  });
});
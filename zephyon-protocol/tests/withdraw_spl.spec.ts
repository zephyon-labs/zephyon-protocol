// tests/spl_withdraw.spec.ts
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { Protocol } from "../target/types/protocol";

import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";

import {
  getProgram,
  initFoundationOnce,
  setupMintAndAtas,
  loadProtocolAuthority,
  airdrop,
  BN,
} from "./_helpers";

async function expectFail(p: Promise<any>) {
  let failed = false;
  try {
    await p;
  } catch {
    failed = true;
  }
  expect(failed).to.eq(true);
}

describe("protocol - spl withdraw", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let program: anchor.Program<Protocol>;
  let programAny: any;

  let treasuryPda: PublicKey;
  let protocolAuth: Keypair;

  before(async () => {
    program = getProgram() as anchor.Program<Protocol>;
    programAny = program as any;

    const foundation = await initFoundationOnce(
      provider as AnchorProvider,
      program as any
    );
    treasuryPda = foundation.treasuryPda;

    protocolAuth = loadProtocolAuthority();
    await airdrop(provider, protocolAuth.publicKey, 2);

    // sanity: treasury authority on-chain must match signer
    const t: any = await program.account.treasury.fetch(treasuryPda);
    expect(t.authority.toBase58()).to.eq(protocolAuth.publicKey.toBase58());

    // hard unpause to avoid cross-test poisoning
    try {
      await programAny.methods
        .setTreasuryPaused(false)
        .accounts({ treasury: treasuryPda, treasuryAuthority: protocolAuth.publicKey } as any)
        .signers([protocolAuth])
        .rpc();
    } catch (_) {}
  });

  it("A) withdraws SPL from treasury ATA to user ATA (authority gated, ATA auto-create)", async () => {
    // create mint + treasury/user ATAs; seed treasury via deposit helper
    const depositor = Keypair.generate();
    await airdrop(provider, depositor.publicKey, 2);

    const { mint, userAta: depositorAta, treasuryAta } = await setupMintAndAtas(
      provider,
      depositor,
      treasuryPda,
      1_000_000n
    );

    // fund treasury using depositor deposit
    await program.methods
      .splDeposit(new BN(900_000))
      .accounts({
        user: depositor.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: depositorAta.address,
        treasuryAta: treasuryAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([depositor])
      .rpc();

    const user = Keypair.generate(); // recipient of withdraw
    await airdrop(provider, user.publicKey, 1);

    const userAta = getAssociatedTokenAddressSync(
      mint,
      user.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const treasuryBefore = await getAccount(provider.connection, treasuryAta.address);
    const userInfoBefore = await provider.connection.getAccountInfo(userAta);

    const amount = 123_456;

    await program.methods
      .splWithdraw(new BN(amount))
      .accounts({
        treasuryAuthority: protocolAuth.publicKey,
        user: user.publicKey,
        treasury: treasuryPda,
        mint,
        userAta,
        treasuryAta: treasuryAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([protocolAuth])
      .rpc();

    // user ATA should be created if missing
    expect(userInfoBefore).to.eq(null);

    const userAfter = await getAccount(provider.connection, userAta);
    const treasuryAfter = await getAccount(provider.connection, treasuryAta.address);

    expect(Number(userAfter.amount)).to.eq(amount);
    expect(Number(treasuryBefore.amount) - Number(treasuryAfter.amount)).to.eq(amount);
  });

  it("B) unauthorized withdraw fails", async () => {
    const depositor = Keypair.generate();
    await airdrop(provider, depositor.publicKey, 2);

    const { mint, userAta: depositorAta, treasuryAta } = await setupMintAndAtas(
      provider,
      depositor,
      treasuryPda,
      1_000_000n
    );

    await program.methods
      .splDeposit(new BN(900_000))
      .accounts({
        user: depositor.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: depositorAta.address,
        treasuryAta: treasuryAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([depositor])
      .rpc();

    const attacker = Keypair.generate();
    await airdrop(provider, attacker.publicKey, 1);

    const attackerAta = getAssociatedTokenAddressSync(
      mint,
      attacker.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await expectFail(
      program.methods
        .splWithdraw(new BN(1))
        .accounts({
          treasuryAuthority: attacker.publicKey, // wrong authority
          user: attacker.publicKey,
          treasury: treasuryPda,
          mint,
          userAta: attackerAta,
          treasuryAta: treasuryAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([attacker])
        .rpc()
    );
  });

  it("C) withdraw fails while paused", async () => {
    const depositor = Keypair.generate();
    await airdrop(provider, depositor.publicKey, 2);

    const { mint, userAta: depositorAta, treasuryAta } = await setupMintAndAtas(
      provider,
      depositor,
      treasuryPda,
      1_000_000n
    );

    await program.methods
      .splDeposit(new BN(900_000))
      .accounts({
        user: depositor.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: depositorAta.address,
        treasuryAta: treasuryAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([depositor])
      .rpc();

    // pause
    await programAny.methods
      .setTreasuryPaused(true)
      .accounts({ treasury: treasuryPda, treasuryAuthority: protocolAuth.publicKey } as any)
      .signers([protocolAuth])
      .rpc();

    const user = Keypair.generate();
    await airdrop(provider, user.publicKey, 1);

    const userAta = getAssociatedTokenAddressSync(
      mint,
      user.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await expectFail(
      program.methods
        .splWithdraw(new BN(1))
        .accounts({
          treasuryAuthority: protocolAuth.publicKey,
          user: user.publicKey,
          treasury: treasuryPda,
          mint,
          userAta,
          treasuryAta: treasuryAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([protocolAuth])
        .rpc()
    );

    // unpause (always)
    await programAny.methods
      .setTreasuryPaused(false)
      .accounts({ treasury: treasuryPda, treasuryAuthority: protocolAuth.publicKey } as any)
      .signers([protocolAuth])
      .rpc();
  });
});

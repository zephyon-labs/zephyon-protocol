import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
const { LAMPORTS_PER_SOL, Keypair, SystemProgram } = anchor.web3;
import { expect, assert } from "chai";
import type { Protocol } from "../target/types/protocol";

import {
  initFoundationOnce,
  deriveUserProfilePda,
  deriveReceiptPdaByUser,
  airdrop,
  leU64,
} from "./_helpers";

describe("Core10 — withdraw flow (full counters)", function () {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const program = (anchor.workspace as any).Protocol as Program<Protocol>;

  const AMOUNT = new BN(500_000); // 0.0005 SOL

  let protocolStatePda: anchor.web3.PublicKey;
  let treasuryPda: anchor.web3.PublicKey;
  let userProfilePda: anchor.web3.PublicKey;
  const user = (provider.wallet as anchor.Wallet).payer;

  before(async () => {
    await airdrop(provider, provider.wallet.publicKey, 2);
    ({ treasuryPda, protocolStatePda } =
      await initFoundationOnce(provider, program, provider.wallet.publicKey));

    [userProfilePda] = deriveUserProfilePda(user.publicKey);
    try {
      await program.methods
        .registerUser()
        .accounts({
          protocolState: protocolStatePda,
          treasury: treasuryPda,
          userProfile: userProfilePda,
          authority: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (_) {}

    const pre: any = await program.account.userProfile.fetch(userProfilePda);
    const txCountBefore = pre.txCount as unknown as BN;
    const [depositReceiptPda] = deriveReceiptPdaByUser(user.publicKey, leU64(txCountBefore));

    await program.methods
      .deposit(new BN(2 * LAMPORTS_PER_SOL))
      .accounts({
        protocolState: protocolStatePda,
        treasury: treasuryPda,
        userProfile: userProfilePda,
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
        receipt: depositReceiptPda,
      })
      .rpc();
  });

  it("happy path: withdraw decreases treasury, increases user, updates counters", async () => {
    const preUser = await provider.connection.getBalance(user.publicKey);
    const preTreasury = await provider.connection.getBalance(treasuryPda);

    const upBefore: any = await program.account.userProfile.fetch(userProfilePda);
    const txCountBefore = upBefore.txCount as unknown as BN;
    const [withdrawReceiptPda] = deriveReceiptPdaByUser(user.publicKey, leU64(txCountBefore));

    await program.methods
      .withdraw(AMOUNT)
      .accounts({
        protocolState: protocolStatePda,
        treasury: treasuryPda,
        userProfile: userProfilePda,
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
        receipt: withdrawReceiptPda,
      })
      .rpc();

    const postUser = await provider.connection.getBalance(user.publicKey);
    const postTreasury = await provider.connection.getBalance(treasuryPda);

    expect(postUser).to.be.greaterThan(preUser);
    expect(postTreasury).to.be.lessThan(preTreasury);

    const up: any = await program.account.userProfile.fetch(userProfilePda);
    expect(Number(up.txCount)).to.equal(Number(txCountBefore) + 1);
    expect(Number(up.withdrawCount)).to.be.greaterThan(0);
    expect(new BN(up.totalWithdrawn).gte(AMOUNT)).to.be.true;
    expect(Number(up.lastWithdrawAt)).to.be.greaterThan(0);
  });
});






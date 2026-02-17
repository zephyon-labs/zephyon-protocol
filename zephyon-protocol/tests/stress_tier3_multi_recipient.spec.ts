/**
 * Tier3A — Multi-Recipient Pay Storm (No Pause)
 *
 * Focus:
 * - Many recipients
 * - Bounded concurrency
 * - Treasury conservation invariant
 * - Receipt uniqueness under distribution
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  mintTo,
} from "@solana/spl-token";
import * as fs from "fs";

import {
  loadProtocolAuthority,
  initFoundationOnce,
  setupMintAndAtas,
  airdrop,
  runBounded,
  withRetry,
  expect,
  NONCE_PAY_BASE,
} from "./_helpers";

describe("stress - Tier3A multi-recipient pay storm", () => {
  const protocolAuth = loadProtocolAuthority();

  const envProvider = AnchorProvider.env();
  const provider = new AnchorProvider(
    envProvider.connection,
    new anchor.Wallet(protocolAuth),
    envProvider.opts
  );

  anchor.setProvider(provider);

  const idl = JSON.parse(
    fs.readFileSync("target/idl/protocol.json", "utf8")
  );

  const programAny = new anchor.Program(idl as any, provider) as any;
  const programId = new PublicKey(idl.address);

  let treasuryPda: PublicKey;
  let treasuryAta: PublicKey;
  let mint: PublicKey;

  const RECIPIENTS = 20;
  const PAY_COUNT = 200;
  const CONCURRENCY = 10;

  const recipients: Keypair[] = [];
  const recipientAtas: PublicKey[] = [];

  before(async () => {
    await airdrop(provider, protocolAuth.publicKey, 2);

    const [treasury] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      programId
    );
    treasuryPda = treasury;

    await initFoundationOnce(provider, programAny);

    const setup = await setupMintAndAtas(
      provider,
      protocolAuth,
      treasuryPda,
      1_000_000n
    );

    mint = setup.mint;
    treasuryAta = setup.treasuryAta.address;

    // fund treasury heavily
    await mintTo(
      provider.connection,
      protocolAuth,
      mint,
      treasuryAta,
      protocolAuth.publicKey,
      500_000
    );

    // create recipients + ATAs
    for (let i = 0; i < RECIPIENTS; i++) {
      const kp = Keypair.generate();
      recipients.push(kp);

      await airdrop(provider, kp.publicKey, 1);

      const ata = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        protocolAuth,
        mint,
        kp.publicKey
      );

      recipientAtas.push(ata.address);
    }
  });

  it("distributes under load without value drift", async () => {
    const treasuryBefore = await getAccount(provider.connection, treasuryAta);

    const recipientBefore: number[] = [];
    for (const ata of recipientAtas) {
      const acc = await getAccount(provider.connection, ata);
      recipientBefore.push(Number(acc.amount));
    }

    let successPays = 0;

    await runBounded(CONCURRENCY, Array.from({ length: PAY_COUNT }), async (_, idx) => {
      await withRetry(
        async () => {
          const targetIndex = Math.floor(Math.random() * RECIPIENTS);

          try {
  await programAny.methods
    .splPay(new BN(1), null, null, new BN(NONCE_PAY_BASE + idx))
    .accounts({
      treasury: treasuryPda,
      treasuryAuthority: protocolAuth.publicKey,
      authority: protocolAuth.publicKey,
      mint,
      treasuryAta,
      recipient: recipients[targetIndex].publicKey,
      recipientAta: recipientAtas[targetIndex],
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  successPays++;

} catch (e: any) {
  const msg = String(e?.message ?? e);
            if (msg.includes("Unauthorized")) return false;
            if (msg.includes("Constraint")) return false;
            if (msg.includes("already in use")) return false;
            if (msg.includes("Allocate: account")) return false;

            return true;
          }
        }
      );
    });

    const treasuryAfter = await getAccount(provider.connection, treasuryAta);

    const treasuryDelta =
      Number(treasuryBefore.amount) - Number(treasuryAfter.amount);

    expect(treasuryDelta).to.eq(successPays);

    let recipientDeltaSum = 0;

    for (let i = 0; i < recipientAtas.length; i++) {
      const after = await getAccount(provider.connection, recipientAtas[i]);
      recipientDeltaSum +=
        Number(after.amount) - recipientBefore[i];
    }

    expect(recipientDeltaSum).to.eq(successPays);
  });
});

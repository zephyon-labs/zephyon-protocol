/**
 * Tier2 – Interleaved Chaos (Layer 1: Authorized PAY only)
 *
 * Purpose (Layer 1):
 * - Validate Tier2 harness wiring
 * - Validate bounded concurrency works
 * - Validate receipt nonce isolation
 * - Validate treasury delta integrity
 *
 * Future Layers:
 * - Pause flips
 * - Unauthorized attempts
 * - Withdraw interleaving
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

import { Protocol } from "../target/types/protocol";

import {
  getProgram,
  initFoundationOnce,
  setupMintAndAtas,
  loadProtocolAuthority,
  airdrop,
  BN,
  expect,
  runBounded,
  withRetry,
} from "./_helpers";

/**
 * IMPORTANT:
 * Tier2 must NEVER share nonce ranges with Tier1.
 */
const BASE_NONCE = 9_000_000;

describe("stress - Tier2 interleaved chaos", function () {
  this.timeout(1_000_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let program: Program<Protocol>;
  let protocolAuthority: Keypair;
  let treasuryPda: PublicKey;

  let mint: PublicKey;
  let treasuryAta: PublicKey;

  async function ensureAtaExists(owner: PublicKey): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const info = await provider.connection.getAccountInfo(ata, "confirmed");
    if (info) return ata;

    const ix = createAssociatedTokenAccountInstruction(
      protocolAuthority.publicKey,
      ata,
      owner,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const tx = new anchor.web3.Transaction().add(ix);
    await provider.sendAndConfirm(tx, [protocolAuthority], {
      commitment: "confirmed",
    });

    return ata;
  }

  before(async () => {
    program = getProgram() as Program<Protocol>;

    const foundation = await initFoundationOnce(provider, program as any);
    treasuryPda = foundation.treasuryPda;

    protocolAuthority = loadProtocolAuthority();
    await airdrop(provider, protocolAuthority.publicKey, 2);

    // Force clean unpaused state
    try {
      await (program as any).methods
        .setTreasuryPaused(false)
        .accounts({
          treasury: treasuryPda,
          authority: protocolAuthority.publicKey,
        } as any)
        .signers([protocolAuthority])
        .rpc();
    } catch (_) {}

    const setup = await setupMintAndAtas(
      provider,
      protocolAuthority,
      treasuryPda,
      1_000_000n
    );

    mint = setup.mint;
    treasuryAta = setup.treasuryAta.address;

    // Fund treasury
    await program.methods
      .splDeposit(new BN(900_000))
      .accounts({
        user: protocolAuthority.publicKey,
        treasury: treasuryPda,
        mint,
        userAta: setup.userAta.address,
        treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([protocolAuthority])
      .rpc();
  });

  it("Layer1: authorized PAY under bounded concurrency", async () => {
    const ACTORS = 6;
    const TOTAL = 80;
    const CONCURRENCY = 5;

    const treasuryBefore = await getAccount(provider.connection, treasuryAta);
    const treasuryStart = Number(treasuryBefore.amount);

    const recipients: Keypair[] = [];
    const recipientAtas: PublicKey[] = [];

    for (let i = 0; i < ACTORS; i++) {
      const kp = Keypair.generate();
      recipients.push(kp);
      await airdrop(provider, kp.publicKey, 1);
      const ata = await ensureAtaExists(kp.publicKey);
      recipientAtas.push(ata);
    }

    let allowedPays = 0;
    let otherFailures = 0;

    await runBounded(
      CONCURRENCY,
      Array.from({ length: TOTAL }),
      async (_, index) => {
        const recipient = recipients[index % ACTORS];
        const recipientAta = recipientAtas[index % ACTORS];
        const nonce = BASE_NONCE + index;

        await withRetry(async () => {
          try {
            const nonceBn = new BN(nonce);

            const [receipt] =
              anchor.web3.PublicKey.findProgramAddressSync(
                [
                  Buffer.from("receipt"),
                  treasuryPda.toBuffer(),
                  nonceBn.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
              );

            const latest =
              await provider.connection.getLatestBlockhash("confirmed");

            const tx = await program.methods
              .splPay(new BN(1), null, null, nonceBn)
              .accounts({
                treasuryAuthority: protocolAuthority.publicKey,
                recipient: recipient.publicKey,
                treasury: treasuryPda,
                mint,
                recipientAta,
                treasuryAta,
                receipt,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
              } as any)
              .transaction();

            tx.feePayer = protocolAuthority.publicKey;
            tx.recentBlockhash = latest.blockhash;
            tx.sign(protocolAuthority);

            const sig = await provider.connection.sendRawTransaction(
              tx.serialize(),
              {
                skipPreflight: false,
                preflightCommitment: "confirmed",
                maxRetries: 3,
              }
            );

            await provider.connection.confirmTransaction(
              {
                signature: sig,
                blockhash: latest.blockhash,
                lastValidBlockHeight: latest.lastValidBlockHeight,
              },
              "confirmed"
            );

            allowedPays++;
          } catch (e) {
            otherFailures++;
            throw e;
          }
        });
      }
    );

    const treasuryAfter = await getAccount(provider.connection, treasuryAta);
    const treasuryEnd = Number(treasuryAfter.amount);

    const delta = treasuryStart - treasuryEnd;

    expect(allowedPays).to.be.greaterThan(0);
    expect(otherFailures).to.eq(0);
    expect(delta).to.eq(allowedPays);
  });
});

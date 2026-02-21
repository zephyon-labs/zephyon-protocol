/**
 * Tier2 — Interleaved Chaos (Layer2A: PAY + PAUSE)
 *
 * This file is intentionally "IDL-adaptive":
 * - Stress tests should validate invariants, not fight TS type-gen drift.
 * - We call program as `any` and adapt to actual method/account names at runtime.
 *
 * CRITICAL HARDENING:
 * - We DO NOT use anchor.workspace for this chaos test.
 * - We construct a Program instance explicitly bound to authorityProvider,
 *   eliminating provider drift / missing signature failures under concurrency.
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  getOrCreateAssociatedTokenAccount,
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
  deriveTreasuryPda,
} from "./_helpers";

type Step =
  | { kind: "PAUSE"; paused: boolean; tag: string }
  | { kind: "PAY"; amount: number; tag: string };

function assertProviderIsAuthority(provider: AnchorProvider, auth: PublicKey) {
  const pk = (provider.wallet as any).publicKey as PublicKey;
  if (!pk?.equals(auth)) {
    throw new Error(
      `Provider wallet drift: provider=${pk?.toBase58?.()} expected=${auth.toBase58()}`
    );
  }
}

function pickPauseMethod(programAny: any): ((paused: boolean) => any) {
  const m = programAny?.methods;
  const candidates = [
    "setPause",
    "setTreasuryPause",
    "setPaused",
    "setTreasuryPaused",
    "pause",
    "togglePause",
  ];

  for (const name of candidates) {
    if (typeof m?.[name] === "function") return (paused: boolean) => m[name](paused);
  }

  throw new Error(
    `No pause method found on program.methods. Tried: ${candidates.join(", ")}`
  );
}

async function callSplPayAdaptive(args: {
  programAny: any;
  amount: number;
  nonce: BN;
  accounts: Record<string, any>;
}) {
  const { programAny, amount, nonce, accounts } = args;

  // Most likely schema (your TS told us 4 args are required)
  try {
    return await programAny.methods
      .splPay(new BN(amount), null, null, nonce)
      .accounts(accounts)
      .rpc();
  } catch (e1: any) {
    // Fallback: older 3-arg schema
    try {
      return await programAny.methods
        .splPay(new BN(amount), null, null)
        .accounts(accounts)
        .rpc();
    } catch (e2: any) {
      // Fallback: nonce earlier
      try {
        return await programAny.methods
          .splPay(new BN(amount), nonce, null, null)
          .accounts(accounts)
          .rpc();
      } catch (e3: any) {
        const msg =
          `splPay adaptive call failed.\n` +
          `Try1(4 args): ${String(e1?.message ?? e1)}\n` +
          `Try2(3 args): ${String(e2?.message ?? e2)}\n` +
          `Try3(4 args alt): ${String(e3?.message ?? e3)}\n`;
        throw new Error(msg);
      }
    }
  }
}

describe("stress - Tier2 interleaved chaos", () => {
  // Canon authority (must match tests/keys/protocol-authority.json)
  const protocolAuth: Keypair = loadProtocolAuthority();

  // Provider locked to protocolAuth
  const envProvider = AnchorProvider.env();
  const authorityProvider = new AnchorProvider(
    envProvider.connection,
    new anchor.Wallet(protocolAuth),
    envProvider.opts
  );

  // IMPORTANT: set provider BEFORE anything else
  anchor.setProvider(authorityProvider);

  // Tripwire: fail fast if wallet is not what we think
  assertProviderIsAuthority(authorityProvider, protocolAuth.publicKey);

// ✅ Load IDL at runtime (no tsconfig resolveJsonModule needed)
const idlPath = "target/idl/protocol.json";
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

// ✅ Anchor TS typings prefer (idl, provider). ProgramId comes from idl.address.
const programAny = new anchor.Program(idl as any, authorityProvider) as any;
const programId = new PublicKey(idl.address); // keep if you need it elsewhere



  let treasuryPda: PublicKey;

  let mint: PublicKey;
  let treasuryAta: PublicKey;

  const recipient = Keypair.generate();
  let recipientAta: PublicKey;

  before(async () => {
    // Fees
    await airdrop(authorityProvider, protocolAuth.publicKey, 2);
    await airdrop(authorityProvider, recipient.publicKey, 2);

    // Ensure treasury exists (helper uses protocol-authority.json internally)
    // NOTE: initFoundationOnce derives treasury PDA using PROGRAM_ID() from workspace;
    //       we do NOT rely on that return to build the program here.
    //       We only need the PDA address; derive it directly to match programId.
    const [treasuryFromIdl] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      programId
    );
    treasuryPda = treasuryFromIdl;

    // Idempotent init (still useful to ensure chain state)
    await initFoundationOnce(authorityProvider, programAny);

    // Mint + ATAs (helper mints to USER ATA; we also fund treasury ATA)
    const { mint: m, treasuryAta: tAta } = await setupMintAndAtas(
      authorityProvider,
      protocolAuth,
      treasuryPda,
      1_000_000n
    );
    mint = m;
    treasuryAta = tAta.address;

    // Recipient ATA exists (payer = protocolAuth)
    const rAta = await getOrCreateAssociatedTokenAccount(
      authorityProvider.connection,
      protocolAuth,
      mint,
      recipient.publicKey
    );
    recipientAta = rAta.address;

    // FUND TREASURY ATA (critical for splPay)
    await mintTo(
      authorityProvider.connection,
      protocolAuth, // payer
      mint,
      treasuryAta,
      protocolAuth.publicKey, // mint authority
      5_000_000
    );
  });

  it("Layer2A: interleaves PAY + PAUSE without invariant drift", async () => {
    const pauseFn = pickPauseMethod(programAny);
await pauseFn(false);


    const treasuryBefore = await getAccount(authorityProvider.connection, treasuryAta);
    const recipientBefore = await getAccount(authorityProvider.connection, recipientAta);

    // Build interleaving plan
    const steps: Step[] = [];
    const cycles = 14;

    for (let i = 0; i < cycles; i++) {
      steps.push({ kind: "PAY", amount: 111 + i, tag: `pay-${i}-A` });

      if (i % 2 === 0) {
        steps.push({ kind: "PAUSE", paused: true, tag: `pause-${i}-on` });
        steps.push({ kind: "PAY", amount: 222 + i, tag: `pay-${i}-B-paused` });
        steps.push({ kind: "PAUSE", paused: false, tag: `pause-${i}-off` });
      } else {
        steps.push({ kind: "PAY", amount: 333 + i, tag: `pay-${i}-B-open` });
      }
    }

    

    const CONCURRENCY = 6;

    let successPays = 0;
    let rejectedPays = 0;
    let pauseSets = 0;
    let sumSuccessful = 0;

    await runBounded(CONCURRENCY, steps, async (step, idx) => {
      await withRetry(
        async () => {
          // Tripwire inside workers too (catches any weird global mutation)
          assertProviderIsAuthority(authorityProvider, protocolAuth.publicKey);

          if (step.kind === "PAUSE") {
            await pauseFn(step.paused)
              .accounts({
                // Keep broad; IDL enforces what it truly needs.
                treasury: treasuryPda,
                treasuryAuthority: protocolAuth.publicKey,
                authority: protocolAuth.publicKey,
                systemProgram: SystemProgram.programId,
              })
              .rpc();

            pauseSets++;
            return;
          }

          // PAY
          const nonce = new BN(NONCE_PAY_BASE + idx);

          try {
            await callSplPayAdaptive({
              programAny,
              amount: step.amount,
              nonce,
              accounts: {
                treasury: treasuryPda,
                treasuryAuthority: protocolAuth.publicKey,
                authority: protocolAuth.publicKey,

                mint,
                treasuryAta,

                recipient: recipient.publicKey,
                recipientAta,

                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
              },
            });

            successPays++;
            sumSuccessful += step.amount;
          } catch (e: any) {
            rejectedPays++;
          }
        },
        {
          label: `step-${idx}-${step.tag}`,
          shouldRetry: (e) => {
            const msg = String(e?.message ?? e);
            if (msg.includes("ProtocolPaused")) return false;
            if (msg.includes("Unauthorized")) return false;
            if (msg.includes("Constraint")) return false;
            return true;
          },
        }
      );
    });

    const treasuryAfter = await getAccount(authorityProvider.connection, treasuryAta);
    const recipientAfter = await getAccount(authorityProvider.connection, recipientAta);

    const treasuryDelta =
      Number(treasuryBefore.amount) - Number(treasuryAfter.amount);
    const recipientDelta =
      Number(recipientAfter.amount) - Number(recipientBefore.amount);

    expect(pauseSets).to.be.greaterThan(0);
    expect(successPays).to.be.greaterThan(0);
    expect(rejectedPays).to.be.greaterThan(0);

    expect(treasuryDelta).to.eq(sumSuccessful);
    expect(recipientDelta).to.eq(sumSuccessful);
  });
});





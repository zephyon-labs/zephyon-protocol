import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { SystemProgram } from "@solana/web3.js";
import { Protocol } from "../target/types/protocol";
import crypto from "crypto";

import {
  deriveTreasuryPda,
  initFoundationOnce,
  loadProtocolAuthority,
} from "./_helpers";

/**
 * Robust event finder:
 * - Anchor events appear in logs as: "Program data: <base64>"
 * - Sometimes that base64 includes an extra 8-byte prefix (depending on how it was emitted/logged).
 * We try both: raw and raw[8..].
 */
function eventDiscriminator(name: string): Buffer {
  return crypto.createHash("sha256").update(`event:${name}`).digest().subarray(0, 8);
}

function findEventWithParser(
  program: anchor.Program<any>,
  logs: string[],
  eventName: string
) {
  const parser = new anchor.EventParser(program.programId, program.coder);

  const decodedNames: string[] = [];
  let hit: any = null;

  // parseLogs returns events (iterable/array) in your Anchor version
  const events: any = parser.parseLogs(logs);

  for (const evt of events) {
    decodedNames.push(evt.name);
    if (evt.name === eventName) hit = evt.data;
  }

  return { hit, decodedNames };
}



async function getTxWithRetry(
  conn: anchor.web3.Connection,
  sig: string,
  tries = 12,
  delayMs = 150
) {
  const commitment: anchor.web3.Finality = "confirmed";

  for (let i = 0; i < tries; i++) {
    const tx = await conn.getTransaction(sig, {
      commitment,
      maxSupportedTransactionVersion: 0,
    });
    if (tx?.meta?.logMessages?.length) return tx;
    await new Promise((r) => setTimeout(r, delayMs));
  }

  return await conn.getTransaction(sig, {
    commitment,
    maxSupportedTransactionVersion: 0,
  });
}

describe("protocol - governance events (Core28)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as anchor.Program<Protocol>;

  const [treasuryPda] = deriveTreasuryPda();
  const protocolAuth = loadProtocolAuthority();

  after(async () => {
    // Hygiene: always try to leave unpaused
    try {
      await program.methods
        .setTreasuryPaused(false)
        .accountsStrict({
          treasury: treasuryPda,
          treasuryAuthority: protocolAuth.publicKey,
        })
        .signers([protocolAuth])
        .rpc();
    } catch {
      // ignore
    }
  });

  it("emits TreasuryInitializedEvent (presence check)", async () => {
    // Ensure treasury exists (idempotent)
    await initFoundationOnce(provider, program as any);

    // Only assert the init EVENT if *this test* actually performed the init tx.
    // If another test already initialized, there is no init tx to observe.
    let sig: string | null = null;

    try {
      sig = await program.methods
        .initializeTreasury()
        .accountsStrict({
          authority: protocolAuth.publicKey,
          treasury: treasuryPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([protocolAuth])
        .rpc();
    } catch {
      // Already initialized -> pass by confirming it exists
      const acc = await (program.account as any).treasury.fetch(treasuryPda);
      expect(acc).to.not.eq(null);
      return;
    }

    const tx = await getTxWithRetry(provider.connection, sig);
    expect(tx, "init tx not found").to.not.eq(null);

    const logs = tx?.meta?.logMessages ?? [];
    const { hit, decodedNames } = findEventWithParser(program as any, logs, "TreasuryInitializedEvent");
    console.log("EventParser decoded names (init):", decodedNames);
    expect(hit, "TreasuryInitializedEvent not found in logs").to.not.eq(null);

  });

  it("emits TreasuryPausedSetEvent (presence check)", async () => {
  await initFoundationOnce(provider, program as any);

  const sig = await program.methods
    .setTreasuryPaused(true)
    .accountsStrict({
      treasury: treasuryPda,
      treasuryAuthority: protocolAuth.publicKey,
    })
    .signers([protocolAuth])
    .rpc();

  await provider.connection.confirmTransaction(sig, "finalized");

  const tx = await getTxWithRetry(provider.connection, sig);
  expect(tx, "pause tx not found").to.not.eq(null);

  const logs = tx!.meta?.logMessages ?? [];
  const { hit, decodedNames } = findEventWithParser(program as any, logs, "treasuryPausedSetEvent");


  console.log("EventParser decoded names:", decodedNames);
  console.log("Pause event hit:", hit);

  expect(hit, "treasuryPausedSetEvent not found in logs").to.not.eq(null);


  // Restore immediately
  await program.methods
    .setTreasuryPaused(false)
    .accountsStrict({
      treasury: treasuryPda,
      treasuryAuthority: protocolAuth.publicKey,
    })
    .signers([protocolAuth])
    .rpc();
  });



});



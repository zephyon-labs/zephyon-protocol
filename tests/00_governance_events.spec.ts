import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { SystemProgram } from "@solana/web3.js";
import { Protocol } from "../target/types/protocol";

import {
  deriveTreasuryPda,
  initFoundationOnce,
  loadProtocolAuthority,
} from "./_helpers";

import { getTxWithRetry } from "./helpers/tx";
import { findEvent } from "./helpers/events";

function bnToNum(x: any): number {
  if (x === null || x === undefined) return NaN;
  if (typeof x === "number") return x;
  if (typeof x === "bigint") return Number(x);
  if (typeof x?.toNumber === "function") return x.toNumber();
  return Number(x);
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

  it("emits TreasuryInitializedEvent (semantics)", async () => {
    await initFoundationOnce(provider, program as any);

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
      // Already initialized — cannot observe init event here; assert existence only
      const acc = await (program.account as any).treasury.fetch(treasuryPda);
      expect(acc).to.not.eq(null);
      return;
    }

    const tx = await getTxWithRetry(provider.connection, sig);
    expect(tx, "init tx not found").to.not.eq(null);

    const logs = tx?.meta?.logMessages ?? [];

    const { hit, matchedName, decodedNames } = findEvent(program as any, logs, [
      "TreasuryInitializedEvent",
      "treasuryInitializedEvent",
    ]);

    console.log("EventParser decoded names (init):", decodedNames);
    console.log("Matched init event:", matchedName);
    console.log("Init event payload:", hit);

    expect(hit, "TreasuryInitializedEvent not found in logs").to.not.eq(null);

    // --- semantic asserts (reviewer-grade) ---
    expect(hit.treasury.toString()).to.eq(treasuryPda.toString());
    expect(hit.authority.toString()).to.eq(protocolAuth.publicKey.toString());

    // init-specific fields
    expect(hit.paused).to.eq(false);
    expect(bnToNum(hit.payCount)).to.be.greaterThanOrEqual(0);

    // bump is u8
    expect(bnToNum(hit.bump)).to.be.within(0, 255);

    // telemetry
    expect(bnToNum(hit.slot)).to.be.greaterThan(0);
    expect(bnToNum(hit.unixTimestamp)).to.be.greaterThan(0);
  });

  it("emits TreasuryPausedSetEvent (semantics: pause)", async () => {
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

    const { hit, matchedName, decodedNames } = findEvent(program as any, logs, [
      "TreasuryPausedSetEvent",
      "treasuryPausedSetEvent",
    ]);

    console.log("EventParser decoded names (pause):", decodedNames);
    console.log("Matched pause event:", matchedName);
    console.log("Pause event payload:", hit);

    expect(hit, "TreasuryPausedSetEvent not found in logs (pause)").to.not.eq(null);

    expect(hit.paused).to.eq(true);
    expect(hit.treasury.toString()).to.eq(treasuryPda.toString());
    expect(hit.authority.toString()).to.eq(protocolAuth.publicKey.toString());

    expect(bnToNum(hit.slot)).to.be.greaterThan(0);
    expect(bnToNum(hit.unixTimestamp)).to.be.greaterThan(0);

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

  it("emits TreasuryPausedSetEvent (semantics: unpause)", async () => {
    await initFoundationOnce(provider, program as any);

    const sig = await program.methods
      .setTreasuryPaused(false)
      .accountsStrict({
        treasury: treasuryPda,
        treasuryAuthority: protocolAuth.publicKey,
      })
      .signers([protocolAuth])
      .rpc();

    await provider.connection.confirmTransaction(sig, "finalized");

    const tx = await getTxWithRetry(provider.connection, sig);
    expect(tx, "unpause tx not found").to.not.eq(null);

    const logs = tx!.meta?.logMessages ?? [];

    const { hit, matchedName, decodedNames } = findEvent(program as any, logs, [
      "TreasuryPausedSetEvent",
      "treasuryPausedSetEvent",
    ]);

    console.log("EventParser decoded names (unpause):", decodedNames);
    console.log("Matched unpause event:", matchedName);
    console.log("Unpause event payload:", hit);

    expect(hit, "TreasuryPausedSetEvent not found in logs (unpause)").to.not.eq(null);

    expect(hit.paused).to.eq(false);
    expect(hit.treasury.toString()).to.eq(treasuryPda.toString());
    expect(hit.authority.toString()).to.eq(protocolAuth.publicKey.toString());

    expect(bnToNum(hit.slot)).to.be.greaterThan(0);
    expect(bnToNum(hit.unixTimestamp)).to.be.greaterThan(0);
  });
});





import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { Protocol } from "../target/types/protocol";

import {
  deriveTreasuryPda,
  initFoundationOnce,
  loadProtocolAuthority,
} from "./_helpers";

import { getTxWithRetry } from "./helpers/tx";
import { findEvent } from "./helpers/events";

function isPubkeyLike(x: any): boolean {
  return (
    x &&
    typeof x.toString === "function" &&
    // PublicKey.toString() is base58; cheap sanity length check:
    x.toString().length >= 32
  );
}

function isBnLike(x: any): boolean {
  return x && typeof x.toNumber === "function";
}

describe("protocol - governance indexer readiness (Build29 Option C)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Protocol as anchor.Program<Protocol>;
  const [treasuryPda] = deriveTreasuryPda();
  const protocolAuth = loadProtocolAuthority();

  after(async () => {
    // Hygiene: leave unpaused
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

  it("indexer-style: tx logs decode TreasuryPausedSetEvent with stable schema", async () => {
    await initFoundationOnce(provider, program as any);

    // Emit a governance event (pause)
    const sig = await program.methods
      .setTreasuryPaused(true)
      .accountsStrict({
        treasury: treasuryPda,
        treasuryAuthority: protocolAuth.publicKey,
      })
      .signers([protocolAuth])
      .rpc();

    // Indexer-style fetch: confirmed is usually enough (faster than finalized)
    const tx = await getTxWithRetry(provider.connection, sig, 18, 150, "confirmed");
    expect(tx, "tx not found").to.not.eq(null);

    const logs = tx!.meta?.logMessages ?? [];
    expect(logs.length, "missing logMessages").to.be.greaterThan(0);

    const { hit, matchedName, decodedNames } = findEvent(program as any, logs, [
      "TreasuryPausedSetEvent",
      "treasuryPausedSetEvent",
    ]);

    console.log("Decoded event names:", decodedNames);
    console.log("Matched event name:", matchedName);
    console.log("Decoded event payload:", hit);

    expect(hit, "TreasuryPausedSetEvent not decoded").to.not.eq(null);

    // --- Schema / type assertions (indexer readiness) ---
    expect(hit).to.have.property("treasury");
    expect(hit).to.have.property("authority");
    expect(hit).to.have.property("paused");
    expect(hit).to.have.property("slot");
    expect(hit).to.have.property("unixTimestamp");

    // Types / shapes
    expect(isPubkeyLike(hit.treasury), "treasury not pubkey-like").to.eq(true);
    expect(isPubkeyLike(hit.authority), "authority not pubkey-like").to.eq(true);
    expect(typeof hit.paused, "paused not boolean").to.eq("boolean");

    // Anchor emits slot/unixTimestamp as BN in TS
    expect(isBnLike(hit.slot), "slot not BN-like").to.eq(true);
    expect(isBnLike(hit.unixTimestamp), "unixTimestamp not BN-like").to.eq(true);

    // Semantics
    expect(hit.treasury.toString()).to.eq(treasuryPda.toString());
    expect(hit.authority.toString()).to.eq(protocolAuth.publicKey.toString());
    expect(hit.paused).to.eq(true);
    expect(hit.slot.toNumber()).to.be.greaterThan(0);
    expect(hit.unixTimestamp.toNumber()).to.be.greaterThan(0);

    // Cleanup: unpause
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

import { expect } from "chai";
import { readFileSync } from "node:fs";
import { Keypair, Message, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";
import { createApproveInstruction, createCloseAccountInstruction, createSetAuthorityInstruction, AuthorityType, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import * as sdk from "../src";
import { canonicalJsonV1 } from "../src/economic/validation";
const fixture = JSON.parse(readFileSync("tests/fixtures/economic-intent-v1.json", "utf8"));
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const envelope = () => sdk.createEconomicIntentEnvelopeV1(copy(fixture.envelope), fixture.qualifiedAsset);
const dummy = (n: number) => Keypair.fromSeed(new Uint8Array(32).fill(n));
function signed(e = envelope(), level: 0 | 1 | 2 = 1) { const tx = Transaction.populate(Message.from(sdk.offlineSponsoredMessageV1(e, fixture.recentBlockhash))); if (level >= 1)
    tx.partialSign(dummy(1)); if (level === 2)
    tx.partialSign(dummy(2)); return tx; }
const bytes = (tx: Transaction) => tx.serialize({ requireAllSignatures: false, verifySignatures: false });
function evidence(e = envelope()) {
    const envelopeDigest = sdk.authorizationBindingDigestV1(e, e.amount.asset);
    return { consent: { schema: "zephyon.economic-consent/v1" as const, consentId: "consent:one", principalId: e.principal.id, envelopeDigest, confirmedAt: e.createdAt }, decision: { schema: "zephyon.runtime-binding/v1" as const, reference: e.runtime, envelopeDigest, result: "approved" as const } };
}
function tuple() { const e = envelope(); return sdk.bindSponsorFinalizationV1({ envelope: e, ...evidence(e), now: e.createdAt, userSignedTransaction: bytes(signed(e)), recentBlockhash: fixture.recentBlockhash, reservedExposureId: "exposure:one" }); }
describe("Asset Identity and Economic Intent V1", () => {
    it("matches independently computed Python serialization/hash vectors for sponsored and current Devnet semantics", () => {
        for (const name of ["envelope", "devnetEnvelope"]) {
            expect(sdk.serializeEconomicEnvelopeV1(fixture[name], fixture.qualifiedAsset)).equal(fixture[name + "Canonical"]);
            expect(sdk.authorizationBindingDigestV1(fixture[name], fixture.qualifiedAsset)).equal(fixture[name + "Digest"]);
        }
        expect(envelope().amount.atomicUnits).equal("1234567");
        expect(envelope().amount.asset.decimals).equal(6);
    });
    it("ignores insertion order, defensively copies/freezes and avoids floating-point economics", () => {
        const reverse = (v: any): any => Array.isArray(v) ? v.map(reverse) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverse(x)])) : v;
        expect(sdk.authorizationBindingDigestV1(reverse(fixture.envelope), fixture.qualifiedAsset)).equal(fixture.envelopeDigest);
        const raw = copy(fixture.envelope), e = sdk.createEconomicIntentEnvelopeV1(raw, fixture.qualifiedAsset);
        raw.principal.id = "changed";
        expect(e.principal.id).equal("account:alice");
        expect(Object.isFrozen(e.amount.asset.network)).equal(true);
    });
    for (const amount of [1, 1.2, "1.0", "01", "1e6", "-1", "+1", " 1", "0", "18446744073709551616"]) {
        it(`rejects noncanonical/out-of-range amount ${amount}`, () => { const e = copy(fixture.envelope); e.amount.atomicUnits = amount; expect(() => sdk.createEconomicIntentEnvelopeV1(e, fixture.qualifiedAsset)).to.throw(); });
    }
    for (const field of ["network", "program", "mint", "decimals"]) {
        it(`rejects qualified asset ${field} drift`, () => { const a = copy(fixture.qualifiedAsset); if (field === "network")
            a.network.genesisHash = dummy(99).publicKey.toBase58(); if (field === "program")
            a.tokenProgram = TOKEN_2022_PROGRAM_ID.toBase58(); if (field === "mint")
            a.mint = dummy(98).publicKey.toBase58(); if (field === "decimals")
            a.decimals = 9; expect(() => sdk.assertQualifiedAssetV1(a, fixture.qualifiedAsset)).to.throw(); });
    }
    it("native identity has no synthetic mint; identity parsing is not asset approval", () => {
        expect(sdk.createAssetIdentityV1(envelope().fee.asset).kind).equal("native");
        expect(() => sdk.createAssetIdentityV1({ ...envelope().fee.asset, mint: dummy(1).publicKey.toBase58() })).to.throw();
        const a = { ...fixture.qualifiedAsset, mint: dummy(8).publicKey.toBase58() };
        expect(sdk.createAssetIdentityV1(a).kind).equal("spl-token");
        expect(() => sdk.assertQualifiedAssetV1(a, fixture.qualifiedAsset)).to.throw();
    });
    it("rejects unknown versions/fields, Unicode ambiguity, accessors and canonical number ambiguities", () => {
        for (const change of [(v: any) => v.schema = "zephyon.economic-intent/v2", (v: any) => v.extra = true, (v: any) => v.principal.id = "acc:é", (v: any) => v.fee.asset.decimals = 6]) {
            const v = copy(fixture.envelope);
            change(v);
            expect(() => sdk.createEconomicIntentEnvelopeV1(v, fixture.qualifiedAsset)).to.throw();
        }
        expect(() => canonicalJsonV1({ n: -0 })).to.throw();
        expect(() => canonicalJsonV1({ n: 0.5 })).to.throw();
        expect(() => canonicalJsonV1({ get n() { throw new Error("getter executed"); } })).to.throw("contract field");
    });
    const mutations: Record<string, (e: any) => void> = {
        environment: e => { e.amount.asset.network.environment = "testnet"; e.fee.asset.network.environment = "testnet"; },
        genesis: e => { e.amount.asset.network.genesisHash = dummy(98).publicKey.toBase58(); e.fee.asset.network.genesisHash = dummy(98).publicKey.toBase58(); },
        tokenProgram: e => e.amount.asset.tokenProgram = TOKEN_2022_PROGRAM_ID.toBase58(), mint: e => e.amount.asset.mint = dummy(8).publicKey.toBase58(), decimals: e => e.amount.asset.decimals = 9,
        amount: e => e.amount.atomicUnits = "1234568", source: e => e.source.account = dummy(8).publicKey.toBase58(), destination: e => e.recipient.account = dummy(9).publicKey.toBase58(), beneficiary: e => e.recipient.beneficiaryId = "account:other",
        feePayer: e => e.fee.signer = dummy(8).publicKey.toBase58(), purpose: e => e.purpose.kind = "creator-payment", reference: e => e.purpose.reference = "order:other", intentVersion: e => e.attempt.intentVersion = "2", expiry: e => e.expiresAt = "2026-09-30T12:04:00.000Z", attempt: e => e.attempt.generation = "2", signer: e => e.source.signer = dummy(8).publicKey.toBase58(), policy: e => e.runtime.decisionId = "decision:other", recipientVersion: e => e.recipient.destinationVersion = "2"
    };
    for (const [name, change] of Object.entries(mutations)) {
        it(`binds material ${name} mutation`, () => { const e = copy(fixture.envelope); change(e); if (name === "environment") {
            expect(() => sdk.authorizationBindingDigestV1(e, e.amount.asset)).to.throw("Test-only Runtime");
            return;
        } const hash = sdk.authorizationBindingDigestV1(e, e.amount.asset); expect(hash).not.equal(fixture.envelopeDigest); expect(() => sdk.assertEconomicAuthorizationV1(e, evidence().consent, evidence().decision, e.createdAt)).to.throw(); });
    }
    it("binds consent, Runtime decision and freshness without a circular digest", () => {
        const e = envelope(), proof = evidence(e);
        sdk.assertEconomicAuthorizationV1(e, proof.consent, proof.decision, e.createdAt);
        expect(() => sdk.assertEconomicAuthorizationV1(e, proof.consent, proof.decision, e.expiresAt)).to.throw();
        expect(() => sdk.assertEconomicAuthorizationV1(e, { ...proof.consent, principalId: "account:eve" }, proof.decision, e.createdAt)).to.throw();
        expect(() => sdk.assertEconomicAuthorizationV1(e, proof.consent, { ...proof.decision, reference: { ...e.runtime, policyVersion: "other" } }, e.createdAt)).to.throw();
    });
});
describe("Sponsored message and authority contract V1 (offline)", () => {
    it("distinguishes absent, partial and complete signatures; only fee-payer signature is final transaction ID", () => {
        const e = envelope(), hash = sdk.exactMessageDigestV1(sdk.offlineSponsoredMessageV1(e, fixture.recentBlockhash));
        const states = [0, 1, 2].map(n => sdk.inspectSponsoredSignaturesV1(bytes(signed(e, n as 0 | 1 | 2)), hash, e.source.signer, e.fee.signer));
        expect(states.map(x => x.state)).deep.equal(["CUSTOMER_ABSENT_SPONSOR_ABSENT", "CUSTOMER_VERIFIED_SPONSOR_ABSENT", "FULLY_SIGNED"]);
        expect(states[0]).not.have.property("finalTransactionId");
        expect(states[1]).not.have.property("finalTransactionId");
        expect(states[2]).have.property("finalTransactionId");
        const tx = signed(e, 2);
        expect((states[2] as any).finalTransactionId).equal(require("bs58").encode(tx.signatures[0].signature));
        expect((states[2] as any).finalTransactionId).not.equal(require("bs58").encode(tx.signatures[1].signature));
    });
    it("rejects invalid signatures, wrong account and sponsor-first artifact", () => {
        const e = envelope(), tx = signed(e), hash = sdk.exactMessageDigestV1(tx.serializeMessage());
        tx.signatures[1].signature![0] ^= 1;
        expect(() => sdk.inspectSponsoredSignaturesV1(bytes(tx), hash, e.source.signer, e.fee.signer)).to.throw();
        expect(() => sdk.inspectSponsoredSignaturesV1(bytes(signed(e)), hash, dummy(7).publicKey.toBase58(), e.fee.signer)).to.throw();
        const early = signed(e, 0);
        early.partialSign(dummy(2));
        expect(() => sdk.inspectSponsoredSignaturesV1(bytes(early), hash, e.source.signer, e.fee.signer)).to.throw();
    });
    const cases: Record<string, (tx: Transaction) => void> = {
        "SOL transfer": tx => tx.add(SystemProgram.transfer({ fromPubkey: dummy(2).publicKey, toPubkey: dummy(3).publicKey, lamports: 1 })),
        "extra token transfer": tx => tx.add(tx.instructions[tx.instructions.length - 1]),
        "approve": tx => tx.add(createApproveInstruction(new PublicKey(envelope().source.account), dummy(7).publicKey, dummy(1).publicKey, 1n)),
        "close": tx => tx.add(createCloseAccountInstruction(new PublicKey(envelope().source.account), dummy(7).publicKey, dummy(1).publicKey)),
        "authority change": tx => tx.add(createSetAuthorityInstruction(new PublicKey(envelope().source.account), dummy(1).publicKey, AuthorityType.AccountOwner, dummy(7).publicKey)),
        "swap or unknown program": tx => tx.add(new TransactionInstruction({ programId: dummy(7).publicKey, keys: [], data: Buffer.from([1]) })),
        "duplicate compute": tx => tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })),
        "oversized fee": tx => { tx.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 999999999n }); },
        "extra writable": tx => { tx.instructions[tx.instructions.length - 1].keys.push({ pubkey: dummy(9).publicKey, isWritable: true, isSigner: false }); },
        "mint writable flag": tx => { tx.instructions[tx.instructions.length - 1].keys[1].isWritable = true; },
        "memo": tx => { tx.instructions[tx.instructions.length - 2].data = Buffer.from("other"); },
        "instruction order": tx => { [tx.instructions[0], tx.instructions[1]] = [tx.instructions[1], tx.instructions[0]]; },
        "fee payer": tx => { tx.feePayer = dummy(9).publicKey; },
        "blockhash": tx => { tx.recentBlockhash = dummy(9).publicKey.toBase58(); }
    };
    for (const [name, change] of Object.entries(cases)) {
        it(`rejects ${name} message mutation`, () => { const tx = signed(envelope(), 0); change(tx); expect(() => sdk.assertSponsoredMessageProfileV1(tx.serializeMessage(), envelope(), fixture.recentBlockhash)).to.throw(); });
    }
    it("binds exact message independently of high-level economics and rejects oversized fee authorization", () => {
        const e = envelope(), a = sdk.offlineSponsoredMessageV1(e, fixture.recentBlockhash), b = sdk.offlineSponsoredMessageV1(e, dummy(9).publicKey.toBase58());
        expect(sdk.exactMessageDigestV1(a)).not.equal(sdk.exactMessageDigestV1(b));
        const bad = copy(fixture.envelope);
        bad.fee.maxPriorityFee = "1999";
        expect(() => sdk.createEconomicIntentEnvelopeV1(bad, fixture.qualifiedAsset)).to.throw();
        expect(() => sdk.bindSponsorFinalizationV1({ envelope: e, ...evidence(), now: e.createdAt, userSignedTransaction: bytes(signed(e, 0)), recentBlockhash: fixture.recentBlockhash, reservedExposureId: "exposure:one" })).to.throw();
    });
    it("binds finalization tuple to all authorization, signer, network and exposure evidence", () => {
        const t = tuple();
        expect(t.requiredSigners).deep.equal([envelope().fee.signer, envelope().source.signer]);
        for (const field of ["messageDigest", "customerSignatureDigest", "envelopeDigest"]) {
            const changed = { ...t, [field]: "ef".repeat(32) };
            expect(sdk.sponsorTupleDigestV1(changed)).not.equal(sdk.sponsorTupleDigestV1(t));
        }
        expect(() => sdk.createSponsorFinalizationTupleV1({ ...t, requiredSigners: [t.userSigner, t.sponsorPublicKey] })).to.throw();
    });
    it("rejects stale A after lost callback, A cancellation and B creation", () => {
        const a = tuple(), open = sdk.createAttemptFenceV1(a.attempt, a.messageDigest, a.envelopeDigest), cancelled = sdk.cancelAttemptV1(open);
        const b = { ...a.attempt, attemptId: "attempt:b", generation: "2", fenceToken: "fence:b" };
        const replacement = sdk.replaceCancelledAttemptV1(cancelled, b, "ef".repeat(32), "01".repeat(32));
        expect(() => sdk.commitFinalizationFenceV1(cancelled, a, "finalization:a")).to.throw();
        expect(() => sdk.commitFinalizationFenceV1(replacement, a, "finalization:a")).to.throw();
        expect(() => sdk.replaceCancelledAttemptV1(open, b, "ef".repeat(32), "01".repeat(32))).to.throw();
        const committed = sdk.commitFinalizationFenceV1(open, a, "finalization:a");
        expect(() => sdk.cancelAttemptV1(committed)).to.throw();
    });
    it("requires a fresh attempt/consent after blockhash renewal", () => {
        const a = tuple(), f = sdk.createAttemptFenceV1(a.attempt, a.messageDigest, a.envelopeDigest), newDigest = sdk.exactMessageDigestV1(sdk.offlineSponsoredMessageV1(envelope(), dummy(9).publicKey.toBase58()));
        expect(() => sdk.assertCurrentAttemptV1(f, a.attempt, newDigest, a.envelopeDigest)).to.throw();
        expect(() => sdk.replaceCancelledAttemptV1(sdk.cancelAttemptV1(f), { ...a.attempt, generation: "2", attemptId: "attempt:b", fenceToken: "fence:b" }, newDigest, a.envelopeDigest)).to.throw();
    });
});
describe("Wallet qualification contract V1", () => {
    function qualified(): any { return { schema: "zephyon.wallet-qualification/v1", walletId: "dummy", walletVersion: "1", platform: "android", transport: "mwa-2.0", osVersion: "test", network: fixture.qualifiedAsset.network, evidenceReference: "test:offline", signOnly: true, exactMessage: true, partialSignatures: true, noHiddenSubmission: true, accountSelection: true, networkBinding: true, verifiableArtifact: true, blockhashPreserved: true, instructionsPreserved: true, interruptionRecovery: true, correlatedResponse: true, advertisedFeatures: ["solana:signTransactions"] }; }
    it("requires the optional MWA sign-only capability, never substitutes signAndSend", () => { sdk.assertWalletQualificationV1(qualified(), fixture.qualifiedAsset.network); const q = qualified(); q.advertisedFeatures = ["solana:signAndSendTransaction"]; expect(() => sdk.assertWalletQualificationV1(q, fixture.qualifiedAsset.network)).to.throw(); });
    for (const field of ["signOnly", "exactMessage", "partialSignatures", "noHiddenSubmission", "accountSelection", "networkBinding", "verifiableArtifact", "blockhashPreserved", "instructionsPreserved", "interruptionRecovery", "correlatedResponse"]) {
        it(`fails closed without ${field}`, () => { const q = qualified(); q[field] = false; expect(() => sdk.assertWalletQualificationV1(q, fixture.qualifiedAsset.network)).to.throw(); });
    }
    it("does not assume iOS MWA support", () => { const q = qualified(); q.platform = "ios"; expect(() => sdk.assertWalletQualificationV1(q, fixture.qualifiedAsset.network)).to.throw(); });
});
describe("Possible-effect certainty is independent of signature completeness", () => {
    it("requires authoritative references, preserves uncertainty and rejects timer-based failure", () => {
        for (const v of [{ state: "IMPOSSIBLE", evidenceReference: "held:artifact" }, { state: "UNESTABLISHED" }, { state: "MAY_HAVE_OCCURRED", commitmentReference: "commit:one" }, { state: "RESOLVED", outcome: "settled", evidenceReference: "finalized:one" }])
            expect(sdk.createPossibleEffectV1(v)).deep.equal(v);
        expect(() => sdk.createPossibleEffectV1({ state: "RESOLVED", outcome: "timeout", evidenceReference: "clock:one" })).to.throw();
        expect(() => sdk.createPossibleEffectV1({ state: "IMPOSSIBLE" })).to.throw();
        expect(() => sdk.createPossibleEffectV1({ state: "FUTURE" })).to.throw();
        const e = envelope(), tx = signed(e, 2), state = sdk.inspectSponsoredSignaturesV1(bytes(tx), sdk.exactMessageDigestV1(tx.serializeMessage()), e.source.signer, e.fee.signer);
        expect(state.state).equal("FULLY_SIGNED");
        expect(state).not.have.property("possibleEffect");
    });
});

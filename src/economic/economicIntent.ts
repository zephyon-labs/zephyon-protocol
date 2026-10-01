import { AssetIdentityV1, EconomicAmountV1, createAssetIdentityV1, createEconomicAmountV1, sameNetworkV1 } from "./assetIdentity";
import { canonicalJsonV1, choice, digest, flag, freeze, hex, id, integer, key, literal, object, smallInteger, time } from "./validation";
export type AttemptIdentityV1 = Readonly<{
    intentId: string;
    intentVersion: string;
    attemptId: string;
    generation: string;
    fenceToken: string;
}>;
export type SourceAuthorityV1 = Readonly<{
    mode: "external-wallet" | "devnet-server";
    signer: string;
    account: string;
    bindingId: string;
    bindingVersion: string;
}>;
export type RuntimePolicyReferenceV1 = Readonly<{
    decisionId: string;
    policyVersion: string;
    evidenceDigest: string;
    validFrom: string;
    validUntil: string;
    scope: "production" | "devnet-test-only";
}>;
export type EconomicIntentEnvelopeV1 = Readonly<{
    schema: "zephyon.economic-intent/v1";
    principal: Readonly<{
        id: string;
        operatorId?: string;
        role?: string;
        mandateReference?: string;
    }>;
    attempt: AttemptIdentityV1;
    nonce: string;
    createdAt: string;
    expiresAt: string;
    source: SourceAuthorityV1;
    recipient: Readonly<{
        id: string;
        snapshotVersion: string;
        beneficiaryId: string;
        destinationBindingId: string;
        destinationVersion: string;
        verification: "verified" | "devnet-unverified";
        wallet: string;
        account: string;
    }>;
    amount: EconomicAmountV1;
    fee: Readonly<{
        mode: "platform-sponsor" | "devnet-server";
        signer: string;
        keyVersion: string;
        asset: AssetIdentityV1;
        maxBaseFee: string;
        maxPriorityFee: string;
        maxRent: string;
        computeUnitLimit: number;
        microLamportsPerUnit: string;
        createDestinationAta: boolean;
    }>;
    purpose: Readonly<{
        kind: "p2p" | "creator-payment" | "service-payment";
        reference?: string;
    }>;
    runtime: RuntimePolicyReferenceV1;
}>;
export function createAttemptIdentityV1(input: unknown): AttemptIdentityV1 {
    const v = object(input, ["intentId", "intentVersion", "attemptId", "generation", "fenceToken"]);
    return freeze({ intentId: id(v.intentId), intentVersion: integer(v.intentVersion, true), attemptId: id(v.attemptId), generation: integer(v.generation, true), fenceToken: id(v.fenceToken) });
}
export function createRuntimePolicyReferenceV1(input: unknown): RuntimePolicyReferenceV1 {
    const v = object(input, ["decisionId", "policyVersion", "evidenceDigest", "validFrom", "validUntil", "scope"]);
    const result = { decisionId: id(v.decisionId), policyVersion: id(v.policyVersion), evidenceDigest: hex(v.evidenceDigest), validFrom: time(v.validFrom), validUntil: time(v.validUntil), scope: choice(v.scope, ["production", "devnet-test-only"] as const) };
    if (result.validFrom >= result.validUntil)
        throw new Error("Invalid policy validity interval.");
    return freeze(result);
}
export function createEconomicIntentEnvelopeV1(input: unknown, qualifiedAsset: AssetIdentityV1): EconomicIntentEnvelopeV1 {
    const v = object(input, ["schema", "principal", "attempt", "nonce", "createdAt", "expiresAt", "source", "recipient", "amount", "fee", "purpose", "runtime"]);
    const p = object(v.principal, ["id"], ["operatorId", "role", "mandateReference"]);
    const s = object(v.source, ["mode", "signer", "account", "bindingId", "bindingVersion"]);
    const r = object(v.recipient, ["id", "snapshotVersion", "beneficiaryId", "destinationBindingId", "destinationVersion", "verification", "wallet", "account"]);
    const f = object(v.fee, ["mode", "signer", "keyVersion", "asset", "maxBaseFee", "maxPriorityFee", "maxRent", "computeUnitLimit", "microLamportsPerUnit", "createDestinationAta"]);
    const purpose = object(v.purpose, ["kind"], ["reference"]);
    const amount = createEconomicAmountV1(v.amount, qualifiedAsset), feeAsset = createAssetIdentityV1(f.asset);
    if (feeAsset.kind !== "native" || !sameNetworkV1(feeAsset.network, amount.asset.network))
        throw new Error("Fee asset must be native SOL in the same genesis domain.");
    const result: EconomicIntentEnvelopeV1 = {
        schema: literal(v.schema, "zephyon.economic-intent/v1"),
        principal: { id: id(p.id), ...(p.operatorId === undefined ? {} : { operatorId: id(p.operatorId) }), ...(p.role === undefined ? {} : { role: id(p.role) }), ...(p.mandateReference === undefined ? {} : { mandateReference: id(p.mandateReference) }) },
        attempt: createAttemptIdentityV1(v.attempt), nonce: hex(v.nonce), createdAt: time(v.createdAt), expiresAt: time(v.expiresAt),
        source: { mode: choice(s.mode, ["external-wallet", "devnet-server"] as const), signer: key(s.signer), account: key(s.account), bindingId: id(s.bindingId), bindingVersion: integer(s.bindingVersion, true) },
        recipient: { id: id(r.id), snapshotVersion: integer(r.snapshotVersion, true), beneficiaryId: id(r.beneficiaryId), destinationBindingId: id(r.destinationBindingId), destinationVersion: integer(r.destinationVersion, true), verification: choice(r.verification, ["verified", "devnet-unverified"] as const), wallet: key(r.wallet), account: key(r.account) },
        amount,
        fee: { mode: choice(f.mode, ["platform-sponsor", "devnet-server"] as const), signer: key(f.signer), keyVersion: id(f.keyVersion), asset: feeAsset, maxBaseFee: integer(f.maxBaseFee), maxPriorityFee: integer(f.maxPriorityFee), maxRent: integer(f.maxRent), computeUnitLimit: smallInteger(f.computeUnitLimit, 1400000, 1), microLamportsPerUnit: integer(f.microLamportsPerUnit), createDestinationAta: flag(f.createDestinationAta) },
        purpose: { kind: choice(purpose.kind, ["p2p", "creator-payment", "service-payment"] as const), ...(purpose.reference === undefined ? {} : { reference: id(purpose.reference) }) }, runtime: createRuntimePolicyReferenceV1(v.runtime)
    };
    if (result.createdAt >= result.expiresAt || result.runtime.validFrom > result.createdAt || result.runtime.validUntil < result.expiresAt)
        throw new Error("Envelope outside policy validity.");
    if (!result.fee.createDestinationAta && result.fee.maxRent !== "0")
        throw new Error("Rent bound without ATA instruction.");
    if ((BigInt(result.fee.computeUnitLimit) * BigInt(result.fee.microLamportsPerUnit) + 999999n) / 1000000n > BigInt(result.fee.maxPriorityFee))
        throw new Error("Priority fee exceeds consent bound.");
    if (result.runtime.scope === "devnet-test-only" && result.amount.asset.network.environment !== "devnet")
        throw new Error("Test-only Runtime evidence cannot authorize another environment.");
    if (result.source.mode === "external-wallet") {
        if (result.fee.mode !== "platform-sponsor" || result.source.signer === result.fee.signer || result.recipient.verification !== "verified")
            throw new Error("External profile requires separate sponsor and verified destination.");
    }
    else if (result.fee.mode !== "devnet-server" || result.source.signer !== result.fee.signer || result.amount.asset.network.environment !== "devnet" || result.runtime.scope !== "devnet-test-only")
        throw new Error("Devnet authority must remain explicitly test-only.");
    return freeze(result);
}
export function serializeEconomicEnvelopeV1(input: unknown, qualifiedAsset: AssetIdentityV1): string { return canonicalJsonV1(createEconomicIntentEnvelopeV1(input, qualifiedAsset)); }
export function authorizationBindingDigestV1(input: unknown, qualifiedAsset: AssetIdentityV1): string { return digest("zephyon:economic-envelope:v1", createEconomicIntentEnvelopeV1(input, qualifiedAsset)); }
export type EconomicConsentV1 = Readonly<{
    schema: "zephyon.economic-consent/v1";
    consentId: string;
    principalId: string;
    envelopeDigest: string;
    confirmedAt: string;
}>;
export type RuntimeDecisionBindingV1 = Readonly<{
    schema: "zephyon.runtime-binding/v1";
    reference: RuntimePolicyReferenceV1;
    envelopeDigest: string;
    result: "approved";
}>;
/** Verifies binding/freshness, not the authenticity of the issuer: trusted evidence ingestion remains a gate. */
export function assertEconomicAuthorizationV1(envelope: EconomicIntentEnvelopeV1, consent: unknown, decision: unknown, now: string): void {
    const e = createEconomicIntentEnvelopeV1(envelope, envelope.amount.asset), hash = authorizationBindingDigestV1(e, e.amount.asset);
    const c = object(consent, ["schema", "consentId", "principalId", "envelopeDigest", "confirmedAt"]), d = object(decision, ["schema", "reference", "envelopeDigest", "result"]);
    literal(c.schema, "zephyon.economic-consent/v1");
    id(c.consentId);
    literal(d.schema, "zephyon.runtime-binding/v1");
    literal(d.result, "approved");
    if (id(c.principalId) !== e.principal.id || hex(c.envelopeDigest) !== hash || hex(d.envelopeDigest) !== hash || canonicalJsonV1(createRuntimePolicyReferenceV1(d.reference)) !== canonicalJsonV1(e.runtime))
        throw new Error("Authorization binding conflict.");
    const n = time(now), at = time(c.confirmedAt);
    if (n < e.createdAt || n >= e.expiresAt || at < e.createdAt || at > n)
        throw new Error("Expired or premature economic authorization.");
}

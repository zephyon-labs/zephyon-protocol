import { NetworkDomainV1, createNetworkDomainV1 } from "./assetIdentity";
import { AttemptIdentityV1, RuntimePolicyReferenceV1, createAttemptIdentityV1, createRuntimePolicyReferenceV1 } from "./economicIntent";
import { canonicalJsonV1, choice, digest, freeze, hex, id, key, literal, object } from "./validation";
export type SignatureCompletenessV1 = Readonly<{
    state: "CUSTOMER_ABSENT_SPONSOR_ABSENT";
}> | Readonly<{
    state: "CUSTOMER_VERIFIED_SPONSOR_ABSENT";
    customerSignatureDigest: string;
}> | Readonly<{
    state: "FULLY_SIGNED";
    customerSignatureDigest: string;
    finalTransactionId: string;
}>;
export type PossibleEffectV1 = Readonly<{
    state: "IMPOSSIBLE";
    evidenceReference: string;
}> | Readonly<{
    state: "UNESTABLISHED";
}> | Readonly<{
    state: "MAY_HAVE_OCCURRED";
    commitmentReference: string;
}> | Readonly<{
    state: "RESOLVED";
    outcome: "settled" | "failed-onchain";
    evidenceReference: string;
}>;
export type ExecutionCorrelationV1 = Readonly<{
    attempt: AttemptIdentityV1;
    handoffId: string;
    messageDigest: string;
    executionId?: string;
    submissionCommitmentId?: string;
    receiptId?: string;
    evidenceReferences: readonly string[];
}>;
export type SponsorFinalizationTupleV1 = Readonly<{
    schema: "zephyon.sponsor-finalization/v1";
    attempt: AttemptIdentityV1;
    network: NetworkDomainV1;
    messageDigest: string;
    requiredSigners: readonly [
        string,
        string
    ];
    userSigner: string;
    customerSignatureDigest: string;
    sponsorPublicKey: string;
    sponsorKeyVersion: string;
    envelopeDigest: string;
    consentId: string;
    runtime: RuntimePolicyReferenceV1;
    reservedExposureId: string;
}>;
export function createSponsorFinalizationTupleV1(input: unknown): SponsorFinalizationTupleV1 {
    const v = object(input, ["schema", "attempt", "network", "messageDigest", "requiredSigners", "userSigner", "customerSignatureDigest", "sponsorPublicKey", "sponsorKeyVersion", "envelopeDigest", "consentId", "runtime", "reservedExposureId"]);
    const sponsor = key(v.sponsorPublicKey), user = key(v.userSigner);
    if (!Array.isArray(v.requiredSigners) || v.requiredSigners.length !== 2 || v.requiredSigners[0] !== sponsor || v.requiredSigners[1] !== user || user === sponsor)
        throw new Error("Expected ordered distinct sponsor and user signers.");
    return freeze({ schema: literal(v.schema, "zephyon.sponsor-finalization/v1"), attempt: createAttemptIdentityV1(v.attempt), network: createNetworkDomainV1(v.network), messageDigest: hex(v.messageDigest), requiredSigners: [sponsor, user] as [
            string,
            string
        ], userSigner: user, customerSignatureDigest: hex(v.customerSignatureDigest), sponsorPublicKey: sponsor, sponsorKeyVersion: id(v.sponsorKeyVersion), envelopeDigest: hex(v.envelopeDigest), consentId: id(v.consentId), runtime: createRuntimePolicyReferenceV1(v.runtime), reservedExposureId: id(v.reservedExposureId) });
}
export function sponsorTupleDigestV1(tuple: unknown): string { return digest("zephyon:sponsor-finalization:v1", createSponsorFinalizationTupleV1(tuple)); }
export type AttemptFenceV1 = Readonly<{
    attempt: AttemptIdentityV1;
    messageDigest: string;
    envelopeDigest: string;
    state: "OPEN" | "CANCELLED" | "FINALIZATION_COMMITTED";
    sponsorFinalizationId?: string;
}>;
export function createAttemptFenceV1(attempt: AttemptIdentityV1, messageDigest: string, envelopeDigest: string): AttemptFenceV1 { return freeze({ attempt: createAttemptIdentityV1(attempt), messageDigest: hex(messageDigest), envelopeDigest: hex(envelopeDigest), state: "OPEN" }); }
export function assertCurrentAttemptV1(current: AttemptFenceV1, candidate: AttemptIdentityV1, messageDigest: string, envelopeDigest: string): void {
    if (current.state !== "OPEN" || canonicalJsonV1(createAttemptIdentityV1(current.attempt)) !== canonicalJsonV1(createAttemptIdentityV1(candidate)) || current.messageDigest !== hex(messageDigest) || current.envelopeDigest !== hex(envelopeDigest))
        throw new Error("Stale, cancelled, finalized, or mismatched attempt.");
}
/** Pure transition; caller must atomically CAS against durable current state, never a stale snapshot. */
export function cancelAttemptV1(current: AttemptFenceV1): AttemptFenceV1 {
    if (current.state === "FINALIZATION_COMMITTED")
        throw new Error("Finalization committed: reconcile the same operation.");
    return freeze({ ...current, state: "CANCELLED" });
}
export function commitFinalizationFenceV1(current: AttemptFenceV1, tuple: SponsorFinalizationTupleV1, sponsorFinalizationId: string): AttemptFenceV1 {
    const t = createSponsorFinalizationTupleV1(tuple);
    assertCurrentAttemptV1(current, t.attempt, t.messageDigest, t.envelopeDigest);
    return freeze({ ...current, state: "FINALIZATION_COMMITTED", sponsorFinalizationId: id(sponsorFinalizationId) });
}
export function replaceCancelledAttemptV1(prior: AttemptFenceV1, next: AttemptIdentityV1, messageDigest: string, envelopeDigest: string): AttemptFenceV1 {
    const n = createAttemptIdentityV1(next), p = createAttemptIdentityV1(prior.attempt);
    if (prior.state !== "CANCELLED" || n.intentId !== p.intentId || BigInt(n.intentVersion) < BigInt(p.intentVersion) || BigInt(n.generation) !== BigInt(p.generation) + 1n || n.attemptId === p.attemptId || n.fenceToken === p.fenceToken || hex(envelopeDigest) === prior.envelopeDigest)
        throw new Error("Replacement requires fenced cancellation, fresh generation and new consent binding.");
    return createAttemptFenceV1(n, messageDigest, envelopeDigest);
}
/** Evidence references identify trusted records; this parser does not establish their authenticity. */
export function createPossibleEffectV1(input: unknown): PossibleEffectV1 {
    const v = object(input, ["state"], ["evidenceReference", "commitmentReference", "outcome"]);
    switch (v.state) {
        case "IMPOSSIBLE":
            object(input, ["state", "evidenceReference"]);
            return freeze({ state: "IMPOSSIBLE", evidenceReference: id(v.evidenceReference) });
        case "UNESTABLISHED":
            object(input, ["state"]);
            return freeze({ state: "UNESTABLISHED" });
        case "MAY_HAVE_OCCURRED":
            object(input, ["state", "commitmentReference"]);
            return freeze({ state: "MAY_HAVE_OCCURRED", commitmentReference: id(v.commitmentReference) });
        case "RESOLVED":
            object(input, ["state", "outcome", "evidenceReference"]);
            return freeze({ state: "RESOLVED", outcome: choice(v.outcome, ["settled", "failed-onchain"] as const), evidenceReference: id(v.evidenceReference) });
        default: throw new Error("Unsupported possible-effect state.");
    }
}

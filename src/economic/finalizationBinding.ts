import { EconomicIntentEnvelopeV1, EconomicConsentV1, RuntimeDecisionBindingV1, assertEconomicAuthorizationV1, authorizationBindingDigestV1, createEconomicIntentEnvelopeV1 } from "./economicIntent";
import { SponsorFinalizationTupleV1, createSponsorFinalizationTupleV1 } from "./authority";
import { Transaction } from "@solana/web3.js";
import { assertSponsoredMessageProfileV1, inspectSponsoredSignaturesV1 } from "./solanaProfile";
/** Offline correlation proof, not signer authority. Issuer authenticity/account state/asset qualification remain caller obligations. */
export function bindSponsorFinalizationV1(input: Readonly<{
    envelope: EconomicIntentEnvelopeV1;
    consent: EconomicConsentV1;
    decision: RuntimeDecisionBindingV1;
    now: string;
    userSignedTransaction: Uint8Array;
    recentBlockhash: string;
    reservedExposureId: string;
}>): SponsorFinalizationTupleV1 {
    const e = createEconomicIntentEnvelopeV1(input.envelope, input.envelope.amount.asset);
    assertEconomicAuthorizationV1(e, input.consent, input.decision, input.now);
    const message = Transaction.from(input.userSignedTransaction).serializeMessage();
    const messageDigest = assertSponsoredMessageProfileV1(message, e, input.recentBlockhash);
    const signatures = inspectSponsoredSignaturesV1(input.userSignedTransaction, messageDigest, e.source.signer, e.fee.signer);
    if (signatures.state !== "CUSTOMER_VERIFIED_SPONSOR_ABSENT")
        throw new Error("Finalization requires verified user signature and absent sponsor signature.");
    return createSponsorFinalizationTupleV1({ schema: "zephyon.sponsor-finalization/v1", attempt: e.attempt, network: e.amount.asset.network, messageDigest, requiredSigners: [e.fee.signer, e.source.signer], userSigner: e.source.signer, customerSignatureDigest: signatures.customerSignatureDigest, sponsorPublicKey: e.fee.signer, sponsorKeyVersion: e.fee.keyVersion, envelopeDigest: authorizationBindingDigestV1(e, e.amount.asset), consentId: input.consent.consentId, runtime: e.runtime, reservedExposureId: input.reservedExposureId });
}

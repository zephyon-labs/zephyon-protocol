import { createNetworkDomainV1, NetworkDomainV1, sameNetworkV1 } from "./assetIdentity";
import { choice, freeze, id, literal, object } from "./validation";
export type WalletQualificationV1 = Readonly<{
    schema: "zephyon.wallet-qualification/v1";
    walletId: string;
    walletVersion: string;
    platform: "web" | "ios" | "android";
    transport: "wallet-standard" | "universal-link" | "mwa-2.0";
    osVersion: string;
    network: NetworkDomainV1;
    evidenceReference: string;
    signOnly: true;
    exactMessage: true;
    partialSignatures: true;
    noHiddenSubmission: true;
    accountSelection: true;
    networkBinding: true;
    verifiableArtifact: true;
    blockhashPreserved: true;
    instructionsPreserved: true;
    interruptionRecovery: true;
    correlatedResponse: true;
    advertisedFeatures: readonly string[];
}>;
const required = ["signOnly", "exactMessage", "partialSignatures", "noHiddenSubmission", "accountSelection", "networkBinding", "verifiableArtifact", "blockhashPreserved", "instructionsPreserved", "interruptionRecovery", "correlatedResponse"] as const;
/** Validates a trusted qualification record, not untrusted wallet self-attestation. */
export function assertWalletQualificationV1(input: unknown, network: NetworkDomainV1): WalletQualificationV1 {
    const v = object(input, ["schema", "walletId", "walletVersion", "platform", "transport", "osVersion", "network", "evidenceReference", "advertisedFeatures", ...required]);
    literal(v.schema, "zephyon.wallet-qualification/v1");
    for (const name of required)
        literal(v[name], true);
    if (!["web", "ios", "android"].includes(String(v.platform)) || !["wallet-standard", "universal-link", "mwa-2.0"].includes(String(v.transport)))
        throw new Error("Unsupported platform/transport.");
    if (!Array.isArray(v.advertisedFeatures) || v.advertisedFeatures.some(x => typeof x !== "string"))
        throw new Error("Invalid wallet capabilities.");
    const features = v.advertisedFeatures.map(id);
    if (v.transport === "mwa-2.0" && (v.platform !== "android" || !features.includes("solana:signTransactions")))
        throw new Error("MWA optional/deprecated sign-only capability must be explicitly qualified; no signAndSend fallback.");
    if (!sameNetworkV1(createNetworkDomainV1(v.network), network))
        throw new Error("Wallet network binding mismatch.");
    return freeze({ schema: "zephyon.wallet-qualification/v1", walletId: id(v.walletId), walletVersion: id(v.walletVersion), platform: choice(v.platform, ["web", "ios", "android"] as const), transport: choice(v.transport, ["wallet-standard", "universal-link", "mwa-2.0"] as const), osVersion: id(v.osVersion), evidenceReference: id(v.evidenceReference), network: createNetworkDomainV1(v.network), advertisedFeatures: features, signOnly: literal(v.signOnly, true), exactMessage: literal(v.exactMessage, true), partialSignatures: literal(v.partialSignatures, true), noHiddenSubmission: literal(v.noHiddenSubmission, true), accountSelection: literal(v.accountSelection, true), networkBinding: literal(v.networkBinding, true), verifiableArtifact: literal(v.verifiableArtifact, true), blockhashPreserved: literal(v.blockhashPreserved, true), instructionsPreserved: literal(v.instructionsPreserved, true), interruptionRecovery: literal(v.interruptionRecovery, true), correlatedResponse: literal(v.correlatedResponse, true) });
}

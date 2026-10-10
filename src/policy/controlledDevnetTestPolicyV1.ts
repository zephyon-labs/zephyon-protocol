import { createAssetIdentityV1, type AssetIdentityV1 } from "../economic/assetIdentity";
import { hex, id, integer, object, time } from "../economic/validation";
import type { RuntimePolicyProfileV1 } from "./runtimePolicyContractsV1";
import { check, createRuntimePolicyProfileV1, guarded } from "./runtimePolicyValidationV1";

export type ControlledDevnetTestPolicyInputV1 = Readonly<{
  qualifiedAsset: AssetIdentityV1;
  policyVersion: string;
  configurationVersion: string;
  configurationFingerprint: string;
  effectiveFrom: string;
  expiresAt: string;
  maxAtomicUnits: string;
  sources: Readonly<Record<"consent" | "eligibility" | "destination", Readonly<{ id: string; version: string }>>>;
}>;

/** The ONLY concrete policy supplied by V1. TEST / DEVNET ONLY, never a production
 * qualification. The registry must independently qualify the supplied genesis/asset.
 * Sources and cap are explicit; no Auth0/vendor, fake trust score or default allowance. */
export function createControlledDevnetTestPolicyV1(input: ControlledDevnetTestPolicyInputV1): RuntimePolicyProfileV1 {
  return guarded("POLICY_INVALID", () => {
    const v = object(input, ["qualifiedAsset", "policyVersion", "configurationVersion", "configurationFingerprint", "effectiveFrom", "expiresAt", "maxAtomicUnits", "sources"]);
    const asset = createAssetIdentityV1(v.qualifiedAsset);
    check(asset.network.environment === "devnet" && asset.kind === "spl-token" && asset.decimals === 6 &&
      asset.tokenProgram === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" && asset.mint === "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    const raw = object(v.sources, ["consent", "eligibility", "destination"]);
    const source = (name: string) => { const s = object(raw[name], ["id", "version"]); return { sourceId: id(s.id), sourceVersion: id(s.version) }; };
    return createRuntimePolicyProfileV1({
      schema: "zephyon.runtime-policy-profile/v1", policyId: "zephyon:test:devnet-usdc:v1", policyVersion: id(v.policyVersion),
      configurationVersion: id(v.configurationVersion), configurationFingerprint: hex(v.configurationFingerprint), network: asset.network,
      scope: "devnet-test-only", effectiveFrom: time(v.effectiveFrom), expiresAt: time(v.expiresAt),
      assets: [{ asset, minAtomicUnits: "1", maxAtomicUnits: integer(v.maxAtomicUnits, true) }], purposes: ["p2p"],
      sourceModes: ["devnet-server"], recipientVerifications: ["devnet-unverified"], recipientKinds: ["direct-wallet"],
      requiredEvidence: [
        { evidenceClass: "economic-consent", ...source("consent"), resource: "envelope" },
        { evidenceClass: "eligibility", ...source("eligibility"), resource: "session" },
        { evidenceClass: "destination", ...source("destination"), resource: "destination" },
      ],
    });
  });
}

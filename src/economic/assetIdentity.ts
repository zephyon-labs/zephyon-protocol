import { canonicalJsonV1, choice, integer, key, literal, object, smallInteger, freeze } from "./validation";
export type NetworkDomainV1 = Readonly<{
    family: "solana";
    environment: "mainnet" | "devnet" | "testnet" | "localnet" | "custom";
    genesisHash: string;
}>;
export type AssetIdentityV1 = Readonly<{
    schema: "zephyon.asset/v1";
    network: NetworkDomainV1;
    decimals: number;
} & ({
    kind: "spl-token";
    tokenProgram: string;
    mint: string;
} | {
    kind: "native";
    nativeId: "sol";
})>;
export type EconomicAmountV1 = Readonly<{
    schema: "zephyon.amount/v1";
    asset: AssetIdentityV1;
    atomicUnits: string;
}>;
export function createNetworkDomainV1(input: unknown): NetworkDomainV1 {
    const v = object(input, ["family", "environment", "genesisHash"]);
    return freeze({ family: literal(v.family, "solana"), environment: choice(v.environment, ["mainnet", "devnet", "testnet", "localnet", "custom"] as const), genesisHash: key(v.genesisHash) });
}
export function createAssetIdentityV1(input: unknown): AssetIdentityV1 {
    const base = object(input, ["schema", "network", "kind", "decimals"], ["tokenProgram", "mint", "nativeId"]);
    const common = { schema: literal(base.schema, "zephyon.asset/v1"), network: createNetworkDomainV1(base.network), decimals: smallInteger(base.decimals, 255) };
    if (base.kind === "spl-token") {
        const v = object(input, ["schema", "network", "kind", "decimals", "tokenProgram", "mint"]);
        return freeze({ ...common, kind: "spl-token", tokenProgram: key(v.tokenProgram), mint: key(v.mint) });
    }
    const v = object(input, ["schema", "network", "kind", "decimals", "nativeId"]);
    literal(v.kind, "native");
    literal(common.decimals, 9);
    return freeze({ ...common, kind: "native", nativeId: literal(v.nativeId, "sol") });
}
/** Qualification is supplied by a trusted registry boundary, never inferred from successful parsing. */
export function assertQualifiedAssetV1(candidate: unknown, trustedDefinition: AssetIdentityV1): AssetIdentityV1 {
    const a = createAssetIdentityV1(candidate), b = createAssetIdentityV1(trustedDefinition);
    if (canonicalJsonV1(a) !== canonicalJsonV1(b))
        throw new Error("Asset differs from qualified identity, network, program or precision.");
    return a;
}
export function sameNetworkV1(a: NetworkDomainV1, b: NetworkDomainV1): boolean { return canonicalJsonV1(createNetworkDomainV1(a)) === canonicalJsonV1(createNetworkDomainV1(b)); }
export function createEconomicAmountV1(input: unknown, trustedDefinition: AssetIdentityV1): EconomicAmountV1 {
    const v = object(input, ["schema", "asset", "atomicUnits"]);
    return freeze({ schema: literal(v.schema, "zephyon.amount/v1"), asset: assertQualifiedAssetV1(v.asset, trustedDefinition), atomicUnits: integer(v.atomicUnits, true) });
}

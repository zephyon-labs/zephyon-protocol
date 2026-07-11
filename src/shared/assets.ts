export type FiatAsset = "USD";

export type StablecoinAsset = "USDC" | "USDT";

export type NativeCryptoAsset =
  | "SOL"
  | "ETH"
  | "BTC"
  | "XRP";

export type ProtocolAsset = "ZERA";

export type SupportedAsset =
  | FiatAsset
  | StablecoinAsset
  | NativeCryptoAsset
  | ProtocolAsset;
import type { SupportedAsset } from "./assets";

export type MoneyAmount = {
  amount: number;
  asset: SupportedAsset;
};
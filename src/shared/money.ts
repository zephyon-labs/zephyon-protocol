import type { SupportedAsset } from "./assets";

export type MoneyAmount = {
  /**
   * Human-readable monetary amount.
   */
  amount: number;

  /**
   * Asset or currency being transferred.
   */
  asset: SupportedAsset;
};
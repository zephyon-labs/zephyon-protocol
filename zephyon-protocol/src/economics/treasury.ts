import type { RevenueAllocation, RevenueBucket } from "./types";

export type TreasuryBalances = Record<RevenueBucket, number>;

export function createEmptyTreasury(): TreasuryBalances {
  return {
    treasuryOperations: 0,
    ecosystemExpansion: 0,
    strategicReserve: 0,
    buybackAndBurn: 0,
    buildersAndContributors: 0,
  };
}

export function applyRevenueAllocation(
  balances: TreasuryBalances,
  allocation: RevenueAllocation
): TreasuryBalances {
  return {
    treasuryOperations:
      balances.treasuryOperations + allocation.treasuryOperations,

    ecosystemExpansion:
      balances.ecosystemExpansion + allocation.ecosystemExpansion,

    strategicReserve:
      balances.strategicReserve + allocation.strategicReserve,

    buybackAndBurn:
      balances.buybackAndBurn + allocation.buybackAndBurn,

    buildersAndContributors:
      balances.buildersAndContributors + allocation.buildersAndContributors,
  };
}
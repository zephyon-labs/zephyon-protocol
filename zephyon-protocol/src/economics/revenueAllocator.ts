import type { RevenueAllocation } from "./types";

export const REVENUE_ALLOCATION_RATES = {
  treasuryOperations: 0.45,
  ecosystemExpansion: 0.2,
  strategicReserve: 0.15,
  buybackAndBurn: 0.1,
  buildersAndContributors: 0.1,
} as const;

export function allocateRevenue(protocolFeeUsd: number): RevenueAllocation {
  if (protocolFeeUsd < 0) {
    throw new Error("protocolFeeUsd cannot be negative");
  }

  return {
    treasuryOperations: protocolFeeUsd * REVENUE_ALLOCATION_RATES.treasuryOperations,
    ecosystemExpansion: protocolFeeUsd * REVENUE_ALLOCATION_RATES.ecosystemExpansion,
    strategicReserve: protocolFeeUsd * REVENUE_ALLOCATION_RATES.strategicReserve,
    buybackAndBurn: protocolFeeUsd * REVENUE_ALLOCATION_RATES.buybackAndBurn,
    buildersAndContributors:
      protocolFeeUsd * REVENUE_ALLOCATION_RATES.buildersAndContributors,
  };
}
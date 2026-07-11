import type { FeeResult } from "./types";

export function calculateProtocolFee(
  amountUsd: number,
  protocolFeeRate: number
): FeeResult {
  if (amountUsd <= 0) {
    throw new Error("amountUsd must be greater than 0");
  }

  if (protocolFeeRate < 0 || protocolFeeRate > 1) {
    throw new Error("protocolFeeRate must be between 0 and 1");
  }

  const protocolFeeUsd = amountUsd * protocolFeeRate;
  const netAmountUsd = amountUsd - protocolFeeUsd;

  return {
    amountUsd,
    protocolFeeUsd,
    netAmountUsd,
    protocolFeeRate,
  };
}
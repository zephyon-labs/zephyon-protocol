import type { PaymentIntent } from "./paymentIntent";
import type { PaymentRail } from "./paymentRail";

export type RailResolutionReason =
  | "explicit_user_selection"
  | "agent_requested"
  | "merchant_required"
  | "lowest_cost"
  | "fastest_available"
  | "default_protocol_rail"
  | "fallback";

export type RailResolutionInput = {
  intent: PaymentIntent;
  preferredRail?: PaymentRail;
  availableRails: PaymentRail[];
};

export type RailResolutionResult = {
  rail: PaymentRail;
  reason: RailResolutionReason;
};

export function resolvePaymentRail(
  input: RailResolutionInput
): RailResolutionResult {
  const { preferredRail, availableRails } = input;

  if (preferredRail && availableRails.includes(preferredRail)) {
    return {
      rail: preferredRail,
      reason: "explicit_user_selection",
    };
  }

  if (availableRails.includes("solana")) {
    return {
      rail: "solana",
      reason: "default_protocol_rail",
    };
  }

  if (availableRails.length > 0) {
    return {
      rail: availableRails[0],
      reason: "fallback",
    };
  }

  throw new Error("No available payment rails.");
}
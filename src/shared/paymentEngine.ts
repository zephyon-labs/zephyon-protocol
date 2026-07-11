import type { PaymentIntent } from "./paymentIntent";
import type { PaymentReceipt } from "./paymentReceipt";

export type PaymentValidationResult = {
  isValid: boolean;
  errors: string[];
};

export function validatePaymentIntent(
  intent: PaymentIntent
): PaymentValidationResult {
  const errors: string[] = [];

  if (!intent.senderId) {
    errors.push("Sender is required.");
  }

  if (!intent.recipientId) {
    errors.push("Recipient is required.");
  }

  if (!intent.recipientWallet) {
    errors.push("Recipient wallet is required.");
  }

  if (!intent.mint) {
    errors.push("Mint is required.");
  }

  if (!Number.isFinite(intent.amountRaw) || intent.amountRaw <= 0) {
    errors.push("Amount must be greater than zero.");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function markPaymentIntentValidated(
  intent: PaymentIntent
): PaymentIntent {
  return {
    ...intent,
    status: "validated",
    updatedAt: new Date().toISOString(),
  };
}

export function markPaymentIntentAwaitingConfirmation(
  intent: PaymentIntent
): PaymentIntent {
  return {
    ...intent,
    status: "awaiting_confirmation",
    updatedAt: new Date().toISOString(),
  };
}

export function confirmPaymentIntent(intent: PaymentIntent): PaymentIntent {
  return {
    ...intent,
    status: "processing",
    confirmedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function completePaymentIntent(
  intent: PaymentIntent,
  receipt: PaymentReceipt
): PaymentIntent {
  return {
    ...intent,
    status: "succeeded",
    receiptId: receipt.id,
    transactionSignature: receipt.transactionSignature,
    completedAt: receipt.settledAt,
    updatedAt: new Date().toISOString(),
  };
}

export function failPaymentIntent(intent: PaymentIntent): PaymentIntent {
  return {
    ...intent,
    status: "failed",
    updatedAt: new Date().toISOString(),
  };
}

export function cancelPaymentIntent(intent: PaymentIntent): PaymentIntent {
  return {
    ...intent,
    status: "cancelled",
    updatedAt: new Date().toISOString(),
  };
}
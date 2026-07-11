export type PaymentReceipt = {
  /**
   * Receipt identifier.
   */
  id: string;

  /**
   * Payment Intent that produced this receipt.
   */
  paymentIntentId: string;

  /**
   * Solana transaction signature.
   */
  transactionSignature: string;

  /**
   * Sender identifier.
   */
  senderId: string;

  /**
   * Recipient identifier.
   */
  recipientId: string;

  /**
   * Mint used.
   */
  mint: string;

  /**
   * Amount transferred.
   */
  amountRaw: number;

  /**
   * Time settled.
   */
  settledAt: string;

  /**
   * Network environment.
   */
  environment: string;
};

export function createPaymentReceipt(
  input: Omit<PaymentReceipt, "id">
): PaymentReceipt {
  return {
    id: `receipt-${Date.now()}`,
    ...input,
  };
}
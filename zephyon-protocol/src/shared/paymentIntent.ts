export type PaymentIntentStatus =
  | "draft"
  | "validated"
  | "awaiting_confirmation"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled";

export type PaymentIntentType =
  | "p2p"
  | "creator_tip"
  | "merchant_purchase"
  | "agent_payment"
  | "subscription"
  | "invoice";

export type PaymentIntent = {
  /**
   * Internal unique identifier.
   */
  id: string;

  /**
   * Payment category.
   */
  type: PaymentIntentType;

  /**
   * Current lifecycle status.
   */
  status: PaymentIntentStatus;

  /**
   * Sender information.
   */
  senderId: string;

  /**
   * Recipient information.
   */
  recipientId: string;

  /**
   * Recipient wallet address.
   */
  recipientWallet: string;

  /**
   * Token mint.
   */
  mint: string;

  /**
   * Raw protocol amount.
   */
  amountRaw: number;

  /**
   * Optional memo.
   */
  memo?: string;

  /**
   * User confirmation timestamp.
   */
  confirmedAt?: string;

  /**
   * Successful execution timestamp.
   */
  completedAt?: string;

  /**
   * Deterministic receipt identifier.
   */
  receiptId?: string;

  /**
   * Solana transaction signature.
   */
  transactionSignature?: string;

  /**
   * Creation timestamp.
   */
  createdAt: string;

  /**
   * Last update timestamp.
   */
  updatedAt: string;
};

export function createPaymentIntent(
  input: Omit<
    PaymentIntent,
    | "id"
    | "status"
    | "createdAt"
    | "updatedAt"
    | "confirmedAt"
    | "completedAt"
    | "receiptId"
    | "transactionSignature"
  >
): PaymentIntent {
  const now = new Date().toISOString();

  return {
    id: `pi-${Date.now()}`,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}
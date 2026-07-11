import {
  InMemoryPaymentAdapterRegistry,
  PaymentOrchestrator,
  resolvePaymentRail,
  validatePaymentIntent,
  type PaymentIntent,
} from "../src/shared";
import { InternalLedgerAdapter } from "../src/adapters";

async function main() {
  const now = new Date().toISOString();

  const intent: PaymentIntent = {
    id: "intent-smoke-001",
    senderId: "sender-matt",
    recipientId: "recipient-nova",
    recipientWallet: "internal-wallet-nova",
    mint: "USDC",
    amountRaw: 2500,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  } as PaymentIntent;

  const registry = new InMemoryPaymentAdapterRegistry();

  registry.register(new InternalLedgerAdapter());

  const orchestrator = new PaymentOrchestrator({
    clock: () => new Date().toISOString(),
    createTransactionId: () => `txn-${crypto.randomUUID()}`,

    validateIntent: (paymentIntent) => {
      const validation = validatePaymentIntent(paymentIntent);

      if (validation.isValid) {
        return { valid: true };
      }

      return {
        valid: false,
        failure: {
          code: "PAYMENT_INTENT_INVALID",
          reason: validation.errors.join(" "),
          recoverable: false,
        },
      };
    },

    resolveRail: (paymentIntent) =>
      resolvePaymentRail({
        intent: paymentIntent,
        preferredRail: "internal",
        availableRails: registry.listRails(),
      }),

    executePayment: (paymentIntent, transaction) => {
      const adapter = registry.getAdapter(transaction.rail);
      return adapter.execute(paymentIntent, transaction);
    },

    monitorSettlement: (paymentIntent, transaction) => {
      const adapter = registry.getAdapter(transaction.rail);
      return adapter.monitorSettlement(paymentIntent, transaction);
    },

    recordHistory: (result) => {
      console.log("History recorder saw:", {
        status: result.status,
        transactionId: result.transaction.id,
        rail: result.transaction.rail,
      });
    },
  });

  const result = await orchestrator.execute({
    intent,
    amount: 25,
    currency: "USDC",
    context: {
      requestedAt: now,
      actorId: "matt",
      requestId: "smoke-test-001",
      metadata: {
        memo: "Runtime smoke test",
      },
    },
  });

  console.log("");
  console.log("========================================");
  console.log(" ZEPHYON PAYMENT RUNTIME SMOKE TEST");
  console.log("========================================");
  console.log("");
  console.log("Status:", result.status);
  console.log("Rail:", result.transaction.rail);
  console.log("Transaction Status:", result.transaction.status);
  console.log("Amount:", result.transaction.amount, result.transaction.currency);
  console.log("External Reference:", result.transaction.blockchain?.signature ?? "N/A");
  console.log("");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("Smoke test failed:");
  console.error(error);

});
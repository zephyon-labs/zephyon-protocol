import { expect } from "chai";
import {
  CanonicalSolanaPaymentRailAdapter,
  ProviderIndependentSolanaDevnetTransport,
  RailProviderOperationError,
  RuntimeExecutionFacade,
} from "../src";

const now = "2026-08-09T12:00:00.000Z";
const context = {
  schemaVersion: 1, requestId: "request:test", correlationId: "correlation:test",
  executionId: "execution:test", paymentIntentId: "payment:test", transactionId: "transaction:test", requestedAt: now,
  actor: { id: "actor:test", type: "person" }, recipient: { id: "recipient:test", type: "person", snapshotVersion: 1, data: {} },
  amount: { asset: "USDC", units: "1", decimals: 6 }, destination: { type: "wallet", network: "solana-devnet", address: "recipient-wallet" },
  selectedRail: "solana", providerIdempotencyKey: "provider:test", decision: { decisionId: "decision:test", status: "approved", evaluatedAt: now },
};
const operation = { schemaVersion: 1 as const, requestId: "request:test", correlationId: "correlation:test", attemptId: "attempt:test", executionId: "execution:test", providerIdempotencyKey: "provider:test", invokedAt: now } as any;

describe("provider-independent Solana Devnet transport", () => {
  it("submits exact prepared bytes once and reconciles through a different provider", async () => {
    let preparedCount = 0, submittedCount = 0, observedCount = 0;
    const bytes = Buffer.from("stable-signed-transaction");
    const transport = new ProviderIndependentSolanaDevnetTransport(
      { prepare: async () => { preparedCount++; return { signature: "sig-one", signedTransactionBase64: bytes.toString("base64"), cluster: "solana-devnet", mint: "mint" }; } },
      { identity: { providerId: "helius-devnet", network: "devnet", role: "submission" }, submitExactSignedTransaction: async (actual) => { submittedCount++; expect(Buffer.from(actual).equals(bytes)).to.equal(true); return { signature: "sig-one", acceptedAt: now }; } },
      { identity: { providerId: "solana-devnet-public", network: "devnet", role: "reconciliation" }, observeSignature: async () => { observedCount++; return { status: "settled", observedAt: now, settledAt: now, slot: "9", confirmationStatus: "confirmed" }; } },
    );
    const runtime = new RuntimeExecutionFacade(new Map([["solana", new CanonicalSolanaPaymentRailAdapter(transport)]]), { eventIdFactory: () => "event:test", clock: () => now });
    const prepared = await runtime.prepareExecution(context);
    const submitted = await runtime.submitExecution(prepared, operation);
    expect(submitted.outcome.outcome).to.equal("accepted");
    const reconciled = await runtime.reconcileExecution(context, { schemaVersion: 1, executionId: "execution:test", rail: "solana", providerIdempotencyKey: "provider:test", providerReference: "sig-one", reconciliationReference: "solana:sig-one", observationSequence: 1 } as any, operation);
    expect(reconciled.outcome.outcome).to.equal("settled");
    expect(preparedCount).to.equal(1); expect(submittedCount).to.equal(1); expect(observedCount).to.equal(1);
    expect((reconciled.outcome as any).evidence.data.reconciliationProviderId).to.equal("solana-devnet-public");
  });

  it("classifies an exception before RPC invocation separately from an ambiguous RPC response", async () => {
    const make = (submitExactSignedTransaction: (bytes: Uint8Array) => Promise<any>) => new ProviderIndependentSolanaDevnetTransport(
      { prepare: async () => ({ signature: "sig-one", signedTransactionBase64: Buffer.from("x").toString("base64"), cluster: "solana-devnet", mint: "mint" }) },
      { identity: { providerId: "helius-devnet", network: "devnet", role: "submission" }, submitExactSignedTransaction },
      { identity: { providerId: "solana-devnet-public", network: "devnet", role: "reconciliation" }, observeSignature: async () => ({ status: "missing", observedAt: now }) },
    );
    try { await make(async () => { throw new RailProviderOperationError("health gate", "not_started"); }).submitTransaction({ payload: { signedTransactionBase64: Buffer.from("x").toString("base64"), signature: "sig-one" } } as any); throw new Error("expected rejection"); }
    catch (error) { expect(error).to.be.instanceOf(RailProviderOperationError); expect((error as RailProviderOperationError).providerContact).to.equal("not_started"); }
    try { await make(async () => { throw new Error("response lost"); }).submitTransaction({ payload: { signedTransactionBase64: Buffer.from("x").toString("base64"), signature: "sig-one" } } as any); throw new Error("expected rejection"); }
    catch (error) { expect(error).to.be.instanceOf(RailProviderOperationError); expect((error as RailProviderOperationError).providerContact).to.equal("may_have_occurred"); }
  });

  it("rejects provider-role aliasing", () => {
    expect(() => new ProviderIndependentSolanaDevnetTransport({ prepare: async () => ({} as any) }, { identity: { providerId: "same", network: "devnet", role: "submission" }, submitExactSignedTransaction: async () => ({} as any) }, { identity: { providerId: "same", network: "devnet", role: "reconciliation" }, observeSignature: async () => ({} as any) })).to.throw("independent");
  });
});

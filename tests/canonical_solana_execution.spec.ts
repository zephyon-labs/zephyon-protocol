import { expect } from "chai";
import {
  CanonicalSolanaPaymentRailAdapter,
  PaymentOrchestrator,
  PaymentRuntime,
  RailProviderOperationError,
  SolanaPaymentAdapter,
  createCanonicalExecutionContext,
  createRailExecutionCommand,
  parseAttemptId, parseCorrelationId, parseExecutionId, parseProviderIdempotencyKey,
  parseProviderReference, parseReconciliationReference, parseRuntimeRequestId,
  type CanonicalSolanaRailTransport, type RailOperationContext, type ReconciliationRequest,
} from "../src";

const NOW = "2026-08-07T18:00:00.000Z";
function input() { return { schemaVersion: 1, requestId: "req-sol", correlationId: "corr-sol", executionId: "exec-sol", paymentIntentId: "intent-sol", transactionId: "tx-sol", requestedAt: NOW, actor: { id: "sender", type: "person" }, recipient: { id: "recipient", type: "person", snapshotVersion: 1, data: {} }, amount: { asset: "USDC", units: "900719925474099300001", decimals: 6 }, destination: { type: "wallet", network: "solana-devnet", address: "Recipient111" }, selectedRail: "solana", providerIdempotencyKey: "key-sol", decision: { decisionId: "decision-sol", status: "approved", evaluatedAt: NOW } }; }
function operation(): RailOperationContext { return { schemaVersion: 1, requestId: parseRuntimeRequestId("op-sol"), correlationId: parseCorrelationId("corr-sol"), attemptId: parseAttemptId("attempt-sol"), executionId: parseExecutionId("exec-sol"), providerIdempotencyKey: parseProviderIdempotencyKey("key-sol"), invokedAt: NOW }; }
function request(): ReconciliationRequest { return { schemaVersion: 1, executionId: parseExecutionId("exec-sol"), rail: "solana", providerIdempotencyKey: parseProviderIdempotencyKey("key-sol"), providerReference: parseProviderReference("signature-sol"), reconciliationReference: parseReconciliationReference("solana:signature-sol") }; }
function transport(overrides: Partial<CanonicalSolanaRailTransport> = {}): CanonicalSolanaRailTransport {
  return { cluster: "solana-devnet", prepareTransaction: async () => ({ signature: "signature-sol", signedTransactionBase64: "c2lnbmVk", cluster: "solana-devnet", mint: "mint-sol", programId: "program-sol" }), submitTransaction: async () => ({ outcome: "accepted", submittedAt: NOW }), getSignatureObservation: async () => ({ status: "missing", observedAt: NOW }), ...overrides };
}

describe("canonical Solana execution adapter", () => {
  it("prepares exact signed material without submission", async () => {
    let submits = 0;
    const adapter = new CanonicalSolanaPaymentRailAdapter(transport({ submitTransaction: async () => { submits++; return { outcome: "accepted", submittedAt: NOW }; } }));
    const prepared = await adapter.prepare(createRailExecutionCommand(createCanonicalExecutionContext(input())));
    expect(submits).to.equal(0);
    expect(prepared.payload.rawAmount).to.equal("900719925474099300001");
    expect(JSON.stringify(prepared)).not.to.include("bigint");
    expect((await adapter.estimateFee(createRailExecutionCommand(createCanonicalExecutionContext(input())))).units).to.equal("0");
    const exactFeeAdapter = new CanonicalSolanaPaymentRailAdapter(transport({ estimateFeeLamports: async () => "900719925474099300009" }));
    expect((await exactFeeAdapter.estimateFee(createRailExecutionCommand(createCanonicalExecutionContext(input())))).units).to.equal("900719925474099300009");
    const unsafeFeeAdapter = new CanonicalSolanaPaymentRailAdapter(transport({ estimateFeeLamports: async () => "1.5" }));
    let feeError: unknown; try { await unsafeFeeAdapter.estimateFee(createRailExecutionCommand(createCanonicalExecutionContext(input()))); } catch (error) { feeError = error; }
    expect(feeError).to.be.instanceOf(Error);
  });

  it("returns accepted and conclusively settled submission outcomes", async () => {
    for (const [result, expected] of [[{ outcome: "accepted", submittedAt: NOW }, "accepted"], [{ outcome: "settled", settledAt: NOW, slot: "90071992547409930001", confirmationStatus: "finalized" }, "settled"]] as const) {
      const adapter = new CanonicalSolanaPaymentRailAdapter(transport({ submitTransaction: async () => result }));
      const outcome = await adapter.submit(await adapter.prepare(createRailExecutionCommand(createCanonicalExecutionContext(input()))), operation());
      expect(outcome.outcome).to.equal(expected);
      expect(JSON.stringify(outcome)).not.to.include("bigint");
    }
  });

  it("distinguishes pre-contact rejection from post-contact ambiguity", async () => {
    for (const [error, expected] of [[new RailProviderOperationError("rejected", "not_started"), "rejected"], [new RailProviderOperationError("timeout", "may_have_occurred"), "unknown"], [new Error("connection lost"), "unknown"]] as const) {
      const adapter = new CanonicalSolanaPaymentRailAdapter(transport({ submitTransaction: async () => { throw error; } }));
      const outcome = await adapter.submit(await adapter.prepare(createRailExecutionCommand(createCanonicalExecutionContext(input()))), operation());
      expect(outcome.outcome).to.equal(expected);
    }
  });

  it("reconciles without submission and treats missing status conservatively", async () => {
    let submits = 0;
    for (const [observation, expected] of [[{ status: "missing", observedAt: NOW }, "pending"], [{ status: "pending", observedAt: NOW, slot: "90071992547409930003", confirmationStatus: "processed" }, "pending"], [{ status: "settled", observedAt: NOW, settledAt: NOW, slot: "99999999999999999", confirmationStatus: "finalized" }, "settled"], [{ status: "failed", observedAt: NOW, failedAt: NOW, slot: "8", errorCode: "InstructionError" }, "failed"]] as const) {
      const adapter = new CanonicalSolanaPaymentRailAdapter(transport({ submitTransaction: async () => { submits++; return { outcome: "accepted", submittedAt: NOW }; }, getSignatureObservation: async () => observation }));
      const outcome = await adapter.reconcile(request(), operation());
      expect(outcome.outcome).to.equal(expected);
      expect(() => JSON.parse(JSON.stringify(outcome))).not.to.throw();
      expect(JSON.stringify(outcome)).not.to.include("bigint");
    }
    expect(submits).to.equal(0);
  });

  it("makes repeated reconciliation safe and normalizes RPC unavailability to unknown", async () => {
    let observations = 0;
    const adapter = new CanonicalSolanaPaymentRailAdapter(transport({ getSignatureObservation: async () => { observations++; return { status: "missing", observedAt: NOW }; } }));
    expect(await adapter.reconcile(request(), operation())).to.deep.equal(await adapter.reconcile(request(), operation()));
    expect(observations).to.equal(2);
    const unavailable = new CanonicalSolanaPaymentRailAdapter(transport({ getSignatureObservation: async () => { throw new Error("RPC unavailable"); } }));
    const outcome = await unavailable.reconcile(request(), operation());
    expect(outcome.outcome).to.equal("unknown");
  });

  it("rejects non-Solana destinations before transport preparation", async () => {
    const command: any = { ...createRailExecutionCommand(createCanonicalExecutionContext(input())), destination: { type: "mock", accountReference: "x" } };
    let error: unknown; try { await new CanonicalSolanaPaymentRailAdapter(transport()).prepare(command); } catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(Error);
  });

  it("keeps canonical and intentionally supported legacy root exports distinct", () => {
    expect(CanonicalSolanaPaymentRailAdapter).not.to.equal(SolanaPaymentAdapter);
    expect(PaymentRuntime).to.be.a("function");
    expect(PaymentOrchestrator).to.be.a("function");
    expect(SolanaPaymentAdapter).to.be.a("function");
  });
});

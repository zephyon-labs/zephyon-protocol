import { expect } from "chai";
import {
  AdapterSubmissionError,
  DeterministicMockRailAdapter,
  RuntimeExecutionFacade,
  createCanonicalExecutionContext,
  createRailEvidence,
  createRuntimeExecutionReceipt,
  parseAttemptId,
  parseCorrelationId,
  parseExecutionId,
  parseProviderIdempotencyKey,
  parseProviderReference,
  parseReconciliationReference,
  parseRuntimeRequestId,
  type CanonicalPaymentRailAdapter,
  type RailOperationContext,
  type ReconciliationRequest,
  type SettlementObservation,
} from "../src";

const NOW = "2026-08-07T15:00:00.000Z";
const LATER = "2026-08-07T15:01:00.000Z";

function contextInput(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1, requestId: "req-200", correlationId: "corr-200", executionId: "exec-200",
    paymentIntentId: "intent-200", transactionId: "transaction-200", requestedAt: NOW,
    actor: { id: "sender-200", type: "person" },
    recipient: { id: "recipient-200", type: "business", snapshotVersion: 1, data: { verified: true } },
    amount: { asset: "USDC", units: "900719925474099300000", decimals: 6 },
    destination: { type: "mock", accountReference: "mock-account-200" }, selectedRail: "mock",
    providerIdempotencyKey: "provider-key-200",
    decision: { decisionId: "decision-200", status: "approved", evaluatedAt: NOW }, ...overrides,
  };
}

function operation(): RailOperationContext {
  return Object.freeze({ schemaVersion: 1, requestId: parseRuntimeRequestId("op-200"), correlationId: parseCorrelationId("corr-200"), attemptId: parseAttemptId("attempt-200"), executionId: parseExecutionId("exec-200"), providerIdempotencyKey: parseProviderIdempotencyKey("provider-key-200"), invokedAt: LATER });
}

function facade(adapter: CanonicalPaymentRailAdapter) {
  let event = 0;
  return new RuntimeExecutionFacade(new Map([["mock", adapter]]), {
    eventIdFactory: () => `event-${++event}`,
    clock: () => LATER,
  });
}

function reconciliation(providerReference?: string, observationSequence = 1): ReconciliationRequest {
  return Object.freeze({ schemaVersion: 1, executionId: parseExecutionId("exec-200"), rail: "mock", providerIdempotencyKey: parseProviderIdempotencyKey("provider-key-200"), ...(providerReference ? { providerReference: parseProviderReference(providerReference) } : {}), reconciliationReference: parseReconciliationReference("mock-reconcile-200"), observationSequence });
}

describe("deterministic Mock Rail", () => {
  it("prepares reproducibly while preserving exact trusted values", () => {
    const adapter = new DeterministicMockRailAdapter("immediate_settled");
    const context = createCanonicalExecutionContext(contextInput());
    const command = require("../src").createRailExecutionCommand(context);
    expect(adapter.prepare(command)).to.deep.equal(adapter.prepare(command));
    expect(adapter.prepare(command).payload.amountUnits).to.equal("900719925474099300000");
    expect(JSON.stringify(adapter.prepare(command))).not.to.include("bigint");
  });

  it("supports canonical submission scenarios without external state", async () => {
    const expected = new Map([
      ["immediate_settled", "settled"], ["accepted_pending", "accepted"],
      ["accepted_then_settled", "accepted"], ["rejected_pre_submission", "rejected"],
      ["authoritative_failed", "accepted"], ["unknown_submission", "unknown"],
      ["unknown_then_settled", "unknown"], ["unknown_then_failed", "unknown"],
      ["persistent_pending", "accepted"],
    ]);
    for (const [scenario, outcome] of expected) {
      const adapter = new DeterministicMockRailAdapter(scenario as any);
      const prepared = await facade(adapter).prepareExecution(contextInput());
      const first = await adapter.submit(prepared.prepared as any, operation());
      const second = await adapter.submit(prepared.prepared as any, operation());
      expect(first).to.deep.equal(second);
      expect(first.outcome, scenario).to.equal(outcome);
    }
  });

  it("reconciles deterministically without invoking submit", async () => {
    class CountedMock extends DeterministicMockRailAdapter { submits = 0; override async submit(p: any, c: any) { this.submits++; return super.submit(p, c); } }
    const adapter = new CountedMock("accepted_then_settled");
    expect((await adapter.reconcile(reconciliation(undefined, 1), operation())).outcome).to.equal("pending");
    expect((await adapter.reconcile(reconciliation(undefined, 2), operation())).outcome).to.equal("settled");
    expect(adapter.submits).to.equal(0);
    expect((await new DeterministicMockRailAdapter("unknown_then_failed").reconcile(reconciliation(), operation())).outcome).to.equal("failed");
    expect((await new DeterministicMockRailAdapter("persistent_pending").reconcile(reconciliation(undefined, 99), operation())).outcome).to.equal("pending");
  });
});

describe("stateless Runtime execution facade and events", () => {
  it("validates before adapter use, resolves exactly, and separates prepare from submit", async () => {
    const adapter = new DeterministicMockRailAdapter("accepted_pending");
    const runtime = facade(adapter);
    let validationError: unknown;
    try { await runtime.prepareExecution(contextInput({ executionId: "bad id" })); } catch (error) { validationError = error; }
    expect(validationError).to.be.instanceOf(Error);
    const prepared = await runtime.prepareExecution(contextInput());
    expect(prepared.events.map(e => e.type)).to.deep.equal(["rail.selected", "submission.prepared"]);
    const submitted = await runtime.submitExecution(prepared, operation());
    expect(submitted.outcome.outcome).to.equal("accepted");
    expect(submitted.observation).to.equal(undefined);
    expect(submitted.events[0].correlationId).to.equal("corr-200");
    expect(JSON.parse(JSON.stringify(submitted.events))).to.deep.equal(submitted.events);
  });

  it("handles missing adapters as safe pre-submission configuration failure", async () => {
    try { await facade(new DeterministicMockRailAdapter("immediate_settled")).prepareExecution(contextInput({ selectedRail: "internal", destination: { type: "internal_account", accountReference: "account" } })); expect.fail(); }
    catch (error: any) { expect(error.code).to.equal("CONFIGURATION_ERROR"); expect(error.sideEffect).to.equal("impossible"); }
  });

  it("normalizes unexpected and explicitly pre-contact submission errors safely", async () => {
    for (const [error, expected] of [[new Error("socket closed"), "unknown"], [new AdapterSubmissionError("invalid request", "not_started"), "rejected"]] as const) {
      const adapter = new DeterministicMockRailAdapter("accepted_pending");
      adapter.submit = async () => { throw error; };
      const runtime = facade(adapter);
      const result = await runtime.submitExecution(await runtime.prepareExecution(contextInput()), operation());
      expect(result.outcome.outcome).to.equal(expected);
      if (expected === "unknown") expect(result.recovery?.action).to.equal("reconcile");
    }
  });

  it("reconciliation is independent, never submits, and emits fact events", async () => {
    class CountedMock extends DeterministicMockRailAdapter { submits = 0; override async submit(p: any, c: any) { this.submits++; return super.submit(p, c); } }
    const adapter = new CountedMock("unknown_then_settled");
    const result = await facade(adapter).reconcileExecution(contextInput(), reconciliation(undefined, 2), operation());
    expect(result.observation.outcome).to.equal("settled");
    expect(result.events.map(e => e.type)).to.deep.equal(["reconciliation.requested", "reconciliation.settled"]);
    expect(adapter.submits).to.equal(0);
  });

  it("normalizes reconciliation exceptions to unknown and emits injected receipt facts", async () => {
    const adapter = new DeterministicMockRailAdapter("persistent_pending");
    adapter.reconcile = async () => { throw new Error("provider unavailable"); };
    const runtime = facade(adapter);
    const result = await runtime.reconcileExecution(contextInput(), reconciliation(), operation());
    expect(result.outcome.outcome).to.equal("unknown");
    expect(result.recovery?.action).to.equal("wait_and_reconcile");
    const receiptEvent = runtime.createReceiptEvent(createCanonicalExecutionContext(contextInput()), "receipt-200");
    expect(receiptEvent).to.include({ eventId: "event-4", occurredAt: LATER, correlationId: "corr-200" });
    expect(receiptEvent.type).to.equal("receipt.created");
  });
});

describe("rail-independent Runtime receipt behavior", () => {
  const context = createCanonicalExecutionContext(contextInput());
  const dependencies = { receiptIdFactory: () => "receipt-200", clock: () => LATER };

  it("creates immutable exact-value receipts only from settled observations", () => {
    const evidence = createRailEvidence({ type: "mock.execution", version: 1, data: { scenario: "immediate_settled" } });
    const settled: SettlementObservation = { outcome: "settled", providerReference: parseProviderReference("mock-provider-200"), settledAt: NOW, observedAt: LATER, evidence };
    const receipt = createRuntimeExecutionReceipt(context, settled, dependencies);
    expect(receipt.receiptId).to.equal("receipt-200");
    expect(receipt.createdAt).to.equal(LATER);
    expect(receipt.amount.units).to.equal("900719925474099300000");
    expect(Object.isFrozen(receipt)).to.equal(true);
    expect(JSON.parse(JSON.stringify(receipt))).to.deep.equal(receipt);
  });

  it("rejects pending, unknown, and failed observations", () => {
    const evidence = createRailEvidence({ type: "test", version: 1, data: {} });
    const failure: any = { code: "SETTLEMENT_FAILED" };
    for (const observation of [
      { outcome: "pending", observedAt: NOW },
      { outcome: "unknown", reconciliationReference: parseReconciliationReference("rec"), observedAt: NOW },
      { outcome: "failed", failedAt: NOW, observedAt: NOW, failure, evidence },
    ]) expect(() => createRuntimeExecutionReceipt(context, observation as any, dependencies)).to.throw(/conclusive settled/);
  });

  it("accepts rail-specific evidence without canonical rail fields changing", () => {
    for (const [type, data] of [["ach.settlement", { traceNumber: "1" }], ["card.settlement", { authorizationReference: "a" }], ["solana.settlement", { signature: "s", cluster: "devnet" }]]) {
      const evidence = createRailEvidence({ type, version: 1, data });
      const receipt = createRuntimeExecutionReceipt(context, { outcome: "settled", providerReference: parseProviderReference("provider"), settledAt: NOW, observedAt: NOW, evidence }, dependencies);
      expect(receipt.evidence.type).to.equal(type);
      expect(receipt).not.to.have.property("signature");
    }
  });
});

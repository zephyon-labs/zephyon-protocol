import { expect } from "chai";

import {
  CANONICAL_RAIL_CONTRACT_VERSION,
  assertPreparedSubmissionMatchesOperation,
  createCanonicalExecutionContext,
  createExactAmount,
  createExecutionFailure,
  createRailEvidence,
  createRailExecutionCommand,
  isSafeForAutomaticRetry,
  parseAttemptId,
  parseCorrelationId,
  parseDecimalAmount,
  parseDecimalInteger,
  parseExecutionId,
  parsePaymentIntentId,
  parseProviderIdempotencyKey,
  parseProviderReference,
  parseReconciliationReference,
  parseRuntimeRequestId,
  parseTransactionId,
  normalizeSubmissionException,
  recommendRecovery,
  type CanonicalPaymentRailAdapter,
  type PreparedSubmission,
  type RailEvidence,
  type RailExecutionCommand,
  type RailOperationContext,
  type ReconciliationOutcome,
  type ReconciliationRequest,
  type RuntimeReceipt,
  type SettlementObservation,
  type SubmissionOutcome,
} from "../src";

const NOW = "2026-08-07T12:00:00.000Z";

function validContext(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    requestId: "req-001",
    correlationId: "correlation-001",
    executionId: "execution-001",
    paymentIntentId: "intent-001",
    transactionId: "transaction-001",
    requestedAt: NOW,
    actor: { id: "actor-001", type: "person" },
    recipient: {
      id: "recipient-001",
      type: "business",
      snapshotVersion: 1,
      data: { verification: "verified" },
    },
    amount: { asset: "USDC", units: "1250000", decimals: 6 },
    destination: { type: "wallet", network: "solana-devnet", address: "wallet-001" },
    selectedRail: "solana",
    providerIdempotencyKey: "provider-key-001",
    decision: { decisionId: "decision-001", status: "approved", evaluatedAt: NOW },
    ...overrides,
  };
}

function ambiguousFailure() {
  return createExecutionFailure({
    code: "SUBMISSION_AMBIGUOUS",
    category: "submission",
    stage: "submission",
    phase: "submission",
    sideEffect: "may_have_occurred",
    message: "Provider response was unavailable.",
    retryable: true,
    occurredAt: NOW,
  });
}

describe("Runtime execution contract exact values", () => {
  it("accepts canonical integer and decimal strings", () => {
    expect(parseDecimalInteger("0")).to.equal("0");
    expect(parseDecimalInteger("900719925474099300000")).to.equal("900719925474099300000");
    expect(parseDecimalAmount("0")).to.equal("0");
    expect(parseDecimalAmount("12.000001")).to.equal("12.000001");
  });

  it("rejects exponent, signs, whitespace, fractions, and leading zeros", () => {
    for (const value of ["1e6", "+1", "-1", " 1", "1 ", "1.1", "01", "00"]) {
      expect(() => parseDecimalInteger(value), value).to.throw();
    }
    for (const value of ["1e6", "+1", "-1", " 1", "1 ", "01.2", "1.0", "1.", ".1"]) {
      expect(() => parseDecimalAmount(value), value).to.throw();
    }
  });

  it("uses JSON-safe strings and rejects unsafe numeric input", () => {
    const amount = createExactAmount({ asset: "USDC", units: "900719925474099300000", decimals: 6 });
    expect(JSON.parse(JSON.stringify(amount))).to.deep.equal({
      asset: "USDC", units: "900719925474099300000", decimals: 6,
    });
    expect(() => createExactAmount({ asset: "USDC", units: Number.MAX_SAFE_INTEGER + 1 })).to.throw();
    expect(() => createExactAmount({ asset: "USDC", units: "1.5" })).to.throw();
  });
});

describe("canonical execution context", () => {
  it("strictly validates, defensively copies, freezes, and serializes trusted input", () => {
    const input = validContext();
    const context = createCanonicalExecutionContext(input);
    (input.recipient as { data: { verification: string } }).data.verification = "mutated";
    expect(context.recipient.data.verification).to.equal("verified");
    expect(Object.isFrozen(context)).to.equal(true);
    expect(Object.isFrozen(context.recipient.data)).to.equal(true);
    expect(() => JSON.stringify(context)).not.to.throw();
    expect(JSON.stringify(context)).not.to.include("bigint");
  });

  it("rejects invalid identifiers, timestamps, amounts, unknown fields, and incompatible destinations", () => {
    expect(() => createCanonicalExecutionContext(validContext({ executionId: "bad id" }))).to.throw(/executionId/);
    expect(() => createCanonicalExecutionContext(validContext({ requestedAt: "tomorrow" }))).to.throw(/timestamp/);
    expect(() => createCanonicalExecutionContext(validContext({ amount: { asset: "USDC", units: "1.2" } }))).to.throw(/units/);
    expect(() => createCanonicalExecutionContext(validContext({ amount: { asset: "USDC", units: "0" } }))).to.throw(/greater than zero/);
    expect(() => createCanonicalExecutionContext({ ...validContext(), clientMetadata: {} })).to.throw(/unsupported field/);
    expect(() => createCanonicalExecutionContext(validContext({
      destination: { type: "wallet", network: "solana-devnet", address: "wallet-001", country: "US" },
    }))).to.throw(/unsupported field/);
    expect(() => createCanonicalExecutionContext(validContext({ selectedRail: "ach" }))).to.throw(/incompatible/);
  });

  it("derives a narrow adapter command without recipient snapshot or decision metadata", () => {
    const command = createRailExecutionCommand(createCanonicalExecutionContext(validContext()));
    expect(command).to.have.keys([
      "schemaVersion", "requestId", "correlationId", "executionId", "paymentIntentId",
      "transactionId", "requestedAt", "actorId", "recipientId", "amount", "destination",
      "rail", "providerIdempotencyKey",
    ]);
    expect(command).not.to.have.property("recipient");
    expect(command).not.to.have.property("decision");
    expect(command).not.to.have.property("metadata");
  });
});

describe("submission, reconciliation, and settlement facts", () => {
  const evidence = createRailEvidence({ type: "test.provider", version: 1, data: { sequence: "42" } });
  const providerReference = parseProviderReference("provider-ref-001");
  const reconciliationReference = parseReconciliationReference("reconcile-ref-001");

  it("expresses rejected, accepted, settled, and unknown submission semantics", () => {
    const rejected: SubmissionOutcome = {
      outcome: "rejected", submissionOccurred: false,
      failure: createExecutionFailure({
        code: "PROVIDER_REJECTED_PRE_SUBMISSION", category: "provider", stage: "submission",
        phase: "pre_submission", sideEffect: "impossible", message: "Rejected.", occurredAt: NOW,
      }),
    };
    const accepted: SubmissionOutcome = {
      outcome: "accepted", providerReference, reconciliationReference, submittedAt: NOW,
    };
    const settled: SubmissionOutcome = {
      outcome: "settled", providerReference, reconciliationReference, settledAt: NOW, evidence,
    };
    const unknown: SubmissionOutcome = {
      outcome: "unknown", submissionMayHaveOccurred: true,
      reconciliationReference, observedAt: NOW, failure: ambiguousFailure(),
    };
    expect(rejected.submissionOccurred).to.equal(false);
    expect(accepted.outcome).to.equal("accepted");
    expect(settled.evidence.type).to.equal("test.provider");
    expect(unknown.submissionMayHaveOccurred).to.equal(true);
    expect(() => JSON.stringify([rejected, accepted, settled, unknown])).not.to.throw();
  });

  it("expresses every reconciliation outcome without a submission operation", () => {
    const outcomes: ReconciliationOutcome[] = [
      { outcome: "pending", observedAt: NOW },
      { outcome: "settled", providerReference, settledAt: NOW, observedAt: NOW, evidence },
      {
        outcome: "failed", failedAt: NOW, observedAt: NOW, evidence,
        failure: createExecutionFailure({
          code: "SETTLEMENT_FAILED", category: "settlement", stage: "settlement",
          phase: "reconciliation", sideEffect: "occurred", message: "Authoritative failure.", occurredAt: NOW,
        }),
      },
      { outcome: "unknown", observedAt: NOW, failure: ambiguousFailure() },
    ];
    expect(outcomes.map(({ outcome }) => outcome)).to.deep.equal(["pending", "settled", "failed", "unknown"]);
  });

  it("serializes rail-independent settlement and receipt contracts", () => {
    const observation: SettlementObservation = {
      outcome: "settled", providerReference, settledAt: NOW, observedAt: NOW, evidence,
    };
    const receipt: RuntimeReceipt = {
      schemaVersion: 1,
      receiptId: "receipt-001",
      paymentIntentId: parsePaymentIntentId("intent-001"),
      executionId: parseExecutionId("execution-001"),
      transactionId: parseTransactionId("transaction-001"),
      rail: "solana",
      amount: createExactAmount({ asset: "USDC", units: "1250000", decimals: 6 }),
      senderId: "actor-001",
      recipientId: "recipient-001",
      settledAt: NOW,
      providerReference,
      evidence,
      createdAt: NOW,
    };
    expect(JSON.parse(JSON.stringify({ observation, receipt }))).to.deep.equal({ observation, receipt });
  });

  it("normalizes unexpected post-contact exceptions to unknown, never failed", () => {
    const postContact = normalizeSubmissionException({
      error: new Error("socket closed"), providerContact: "may_have_occurred",
      reconciliationReference, observedAt: NOW,
    });
    expect(postContact.outcome).to.equal("unknown");
    const preContact = normalizeSubmissionException({
      error: new Error("configuration unavailable"), providerContact: "not_started",
      reconciliationReference, observedAt: NOW,
    });
    expect(preContact.outcome).to.equal("rejected");
  });
});

describe("phase-aware recovery", () => {
  it("allows retry only for retryable pre-submission failures", () => {
    const failure = createExecutionFailure({
      code: "PROVIDER_UNAVAILABLE", category: "provider", stage: "submission",
      phase: "pre_submission", sideEffect: "impossible", message: "Unavailable.",
      retryable: true, occurredAt: NOW,
    });
    expect(isSafeForAutomaticRetry(failure)).to.equal(true);
    expect(recommendRecovery({ failure, attempt: 1 })).to.deep.include({
      action: "retry_pre_submission", retryable: true,
    });
  });

  it("routes ambiguous submission and settlement timeout to reconciliation", () => {
    expect(recommendRecovery({ failure: ambiguousFailure() }).action).to.equal("reconcile");
    const timeout = createExecutionFailure({
      code: "SETTLEMENT_TIMEOUT", category: "timeout", stage: "settlement",
      phase: "settlement", sideEffect: "may_have_occurred", message: "Timed out.",
      retryable: true, occurredAt: NOW,
    });
    expect(isSafeForAutomaticRetry(timeout)).to.equal(false);
    expect(recommendRecovery({ failure: timeout, attempt: 99 }).action).to.equal("wait_and_reconcile");
  });
});

describe("canonical rail adapter contract", () => {
  class DeterministicAdapter implements CanonicalPaymentRailAdapter<PreparedSubmission, RailEvidence> {
    readonly rail = "solana" as const;
    readonly contractVersion = CANONICAL_RAIL_CONTRACT_VERSION;
    submitCount = 0;

    prepare(command: RailExecutionCommand): PreparedSubmission {
      return Object.freeze({
        schemaVersion: 1,
        contractVersion: this.contractVersion,
        rail: this.rail,
        executionId: command.executionId,
        providerIdempotencyKey: command.providerIdempotencyKey,
        payload: Object.freeze({ destinationType: command.destination.type, units: command.amount.units }),
      });
    }

    async submit(_prepared: PreparedSubmission, _context: RailOperationContext): Promise<SubmissionOutcome> {
      this.submitCount += 1;
      return {
        outcome: "accepted",
        providerReference: parseProviderReference("provider-ref-001"),
        reconciliationReference: parseReconciliationReference("reconcile-ref-001"),
        submittedAt: NOW,
      };
    }

    async reconcile(_request: ReconciliationRequest, _context: RailOperationContext): Promise<ReconciliationOutcome> {
      return { outcome: "pending", observedAt: NOW };
    }
  }

  it("prepares deterministically and enforces stable execution/idempotency identity", async () => {
    const adapter = new DeterministicAdapter();
    const command = createRailExecutionCommand(createCanonicalExecutionContext(validContext()));
    const first = await adapter.prepare(command);
    const second = await adapter.prepare(command);
    expect(first).to.deep.equal(second);
    expect(adapter.contractVersion).to.equal(1);
    const operation: RailOperationContext = {
      schemaVersion: 1,
      requestId: parseRuntimeRequestId("req-001"),
      correlationId: parseCorrelationId("correlation-001"),
      attemptId: parseAttemptId("attempt-001"),
      executionId: parseExecutionId("execution-001"),
      providerIdempotencyKey: parseProviderIdempotencyKey("provider-key-001"),
      invokedAt: NOW,
    };
    expect(() => assertPreparedSubmissionMatchesOperation(first, operation, adapter)).not.to.throw();
    expect(() => assertPreparedSubmissionMatchesOperation(first, {
      ...operation, providerIdempotencyKey: parseProviderIdempotencyKey("changed-key"),
    }, adapter)).to.throw(/remain stable/);

    const request: ReconciliationRequest = {
      schemaVersion: 1,
      executionId: operation.executionId,
      rail: "solana",
      providerIdempotencyKey: operation.providerIdempotencyKey,
      reconciliationReference: parseReconciliationReference("reconcile-ref-001"),
    };
    await adapter.reconcile(request, operation);
    expect(adapter.submitCount).to.equal(0);
  });
});

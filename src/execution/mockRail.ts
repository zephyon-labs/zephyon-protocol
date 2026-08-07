import { createHash } from "crypto";
import { createExecutionFailure } from "../resilience/executionRecovery";
import { createRailEvidence, type RailEvidence } from "./railEvidence";
import type { RailExecutionCommand } from "./executionContext";
import {
  CANONICAL_RAIL_CONTRACT_VERSION,
  assertPreparedSubmissionMatchesOperation,
  type CanonicalPaymentRailAdapter,
  type PreparedSubmission,
  type RailOperationContext,
} from "./railAdapter";
import type { ReconciliationOutcome, ReconciliationRequest, SubmissionOutcome } from "./outcomes";
import { parseProviderReference, parseReconciliationReference } from "./identifiers";

export type MockRailScenario =
  | "immediate_settled"
  | "accepted_pending"
  | "accepted_then_settled"
  | "rejected_pre_submission"
  | "authoritative_failed"
  | "unknown_submission"
  | "unknown_then_settled"
  | "unknown_then_failed"
  | "persistent_pending";

export type MockRailEvidence = RailEvidence & Readonly<{
  type: "mock.execution";
  version: 1;
}>;

export type MockPreparedSubmission = PreparedSubmission & Readonly<{
  rail: "mock";
  payload: Readonly<{
    scenario: MockRailScenario;
    providerReference: string;
    reconciliationReference: string;
    amountUnits: string;
    asset: string;
    destinationReference: string;
  }>;
}>;

export class DeterministicMockRailAdapter implements CanonicalPaymentRailAdapter<MockPreparedSubmission, MockRailEvidence> {
  readonly rail = "mock" as const;
  readonly contractVersion = CANONICAL_RAIL_CONTRACT_VERSION;

  constructor(readonly scenario: MockRailScenario) {}

  prepare(command: RailExecutionCommand): MockPreparedSubmission {
    if (command.rail !== "mock" || command.destination.type !== "mock") {
      throw new Error("Mock Rail requires a trusted mock destination.");
    }
    const seed = `${command.executionId}:${command.providerIdempotencyKey}:${this.scenario}`;
    return Object.freeze({
      schemaVersion: 1,
      contractVersion: this.contractVersion,
      rail: "mock",
      executionId: command.executionId,
      providerIdempotencyKey: command.providerIdempotencyKey,
      payload: Object.freeze({
        scenario: this.scenario,
        providerReference: `mock_${digest(seed, "provider")}`,
        reconciliationReference: `mock_rec_${digest(seed, "reconcile")}`,
        amountUnits: command.amount.units,
        asset: command.amount.asset,
        destinationReference: command.destination.accountReference,
      }),
    });
  }

  async submit(prepared: MockPreparedSubmission, context: RailOperationContext): Promise<SubmissionOutcome<MockRailEvidence>> {
    assertPreparedSubmissionMatchesOperation(prepared, context, this);
    const evidence = mockEvidence(prepared.payload.scenario, prepared.payload.providerReference, 0, "submission");
    const providerReference = parseProviderReference(prepared.payload.providerReference);
    const reconciliationReference = parseReconciliationReference(prepared.payload.reconciliationReference);
    switch (prepared.payload.scenario) {
      case "immediate_settled":
        return Object.freeze({ outcome: "settled", providerReference, reconciliationReference, settledAt: context.invokedAt, evidence });
      case "rejected_pre_submission":
        return Object.freeze({ outcome: "rejected", submissionOccurred: false, failure: failure("PROVIDER_REJECTED_PRE_SUBMISSION", "pre_submission", "impossible", context.invokedAt), evidence });
      case "unknown_submission":
      case "unknown_then_settled":
      case "unknown_then_failed":
        return Object.freeze({ outcome: "unknown", submissionMayHaveOccurred: true, reconciliationReference, observedAt: context.invokedAt, failure: failure("SUBMISSION_AMBIGUOUS", "submission", "may_have_occurred", context.invokedAt), evidence });
      default:
        return Object.freeze({ outcome: "accepted", providerReference, reconciliationReference, submittedAt: context.invokedAt, evidence });
    }
  }

  async reconcile(request: ReconciliationRequest, context: RailOperationContext): Promise<ReconciliationOutcome<MockRailEvidence>> {
    const sequence = request.observationSequence ?? 1;
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("observationSequence must be a positive safe integer.");
    const providerReference = request.providerReference ?? parseProviderReference(`mock_${digest(`${request.executionId}:${request.providerIdempotencyKey}:${this.scenario}`, "provider")}`);
    const evidence = mockEvidence(this.scenario, providerReference, sequence, "reconciliation");
    if (this.scenario === "authoritative_failed" || this.scenario === "unknown_then_failed") {
      return Object.freeze({ outcome: "failed", providerReference, failedAt: context.invokedAt, observedAt: context.invokedAt, failure: failure("SETTLEMENT_FAILED", "settlement", "occurred", context.invokedAt), evidence });
    }
    if (this.scenario === "accepted_then_settled" || this.scenario === "unknown_then_settled" || this.scenario === "immediate_settled") {
      if (sequence >= 2 || this.scenario === "immediate_settled") {
        return Object.freeze({ outcome: "settled", providerReference, settledAt: context.invokedAt, observedAt: context.invokedAt, evidence });
      }
    }
    return Object.freeze({ outcome: "pending", observedAt: context.invokedAt, evidence });
  }
}

function digest(seed: string, purpose: string): string {
  return createHash("sha256").update(`zephiyon-mock-v1:${purpose}:${seed}`, "utf8").digest("hex").slice(0, 32);
}

function mockEvidence(scenario: MockRailScenario, providerReference: string, sequence: number, result: string): MockRailEvidence {
  return createRailEvidence({ type: "mock.execution", version: 1, data: { scenario, providerReference, observationSequence: sequence, result } }) as MockRailEvidence;
}

function failure(code: "PROVIDER_REJECTED_PRE_SUBMISSION" | "SUBMISSION_AMBIGUOUS" | "SETTLEMENT_FAILED", phase: "pre_submission" | "submission" | "settlement", sideEffect: "impossible" | "may_have_occurred" | "occurred", occurredAt: string) {
  return createExecutionFailure({ code, category: phase === "settlement" ? "settlement" : "provider", stage: phase === "pre_submission" ? "adapter" : phase, phase, sideEffect, message: `Deterministic Mock Rail ${code.toLowerCase()}.`, retryable: false, occurredAt });
}

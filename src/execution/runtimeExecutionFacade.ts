import { createExecutionFailure, recommendRecovery, type RecoveryRecommendation } from "../resilience/executionRecovery";
import { createCanonicalExecutionContext, createRailExecutionCommand, type CanonicalExecutionContext } from "./executionContext";
import { parseReconciliationReference } from "./identifiers";
import { normalizeSubmissionException, type ReconciliationOutcome, type ReconciliationRequest, type SubmissionOutcome } from "./outcomes";
import { RailProviderOperationError, type CanonicalPaymentRailAdapter, type PreparedSubmission, type RailOperationContext } from "./railAdapter";
import type { RailEvidence } from "./railEvidence";
import type { SettlementObservation } from "./settlementObservation";
import { createRuntimeExecutionEvent, recoveryEventPayload, type RuntimeEventDependencies, type RuntimeExecutionEvent } from "./runtimeEvents";

export type CanonicalRailAdapterRegistry = ReadonlyMap<string, CanonicalPaymentRailAdapter>;

/** @deprecated Throw RailProviderOperationError directly from new adapters. */
export class AdapterSubmissionError extends RailProviderOperationError {
  constructor(message: string, readonly providerContact: "not_started" | "may_have_occurred") {
    super(message, providerContact);
    this.name = "AdapterSubmissionError";
  }
}

export type PreparedExecution = Readonly<{ context: CanonicalExecutionContext; prepared: PreparedSubmission; events: readonly RuntimeExecutionEvent[] }>;
export type SubmissionResult = Readonly<{ outcome: SubmissionOutcome; observation?: SettlementObservation; recovery?: RecoveryRecommendation; events: readonly RuntimeExecutionEvent[] }>;
export type ReconciliationResult = Readonly<{ outcome: ReconciliationOutcome; observation: SettlementObservation; recovery?: RecoveryRecommendation; events: readonly RuntimeExecutionEvent[] }>;

export class RuntimeExecutionFacade {
  constructor(private readonly adapters: CanonicalRailAdapterRegistry, private readonly eventDependencies: RuntimeEventDependencies) {}

  async prepareExecution(input: unknown): Promise<PreparedExecution> {
    const context = createCanonicalExecutionContext(input);
    const adapter = this.resolve(context);
    const prepared = await adapter.prepare(createRailExecutionCommand(context));
    return Object.freeze({ context, prepared, events: Object.freeze([
      this.event("rail.selected", context, { rail: context.selectedRail }),
      this.event("submission.prepared", context, { contractVersion: prepared.contractVersion }),
    ]) });
  }

  async submitExecution(execution: PreparedExecution, operation: RailOperationContext): Promise<SubmissionResult> {
    const adapter = this.resolve(execution.context);
    const events: RuntimeExecutionEvent[] = [this.event("submission.requested", execution.context, { attemptId: operation.attemptId })];
    let outcome: SubmissionOutcome;
    try {
      outcome = await adapter.submit(execution.prepared, operation);
    } catch (error) {
      const certainty = error instanceof RailProviderOperationError ? error.providerContact : "may_have_occurred";
      outcome = normalizeSubmissionException({ error, providerContact: certainty, reconciliationReference: parseReconciliationReference(`runtime:${operation.executionId}`), observedAt: operation.invokedAt, correlationId: operation.correlationId });
    }
    return this.submissionResult(execution.context, outcome, events);
  }

  async reconcileExecution(contextInput: unknown, request: ReconciliationRequest, operation: RailOperationContext): Promise<ReconciliationResult> {
    const context = createCanonicalExecutionContext(contextInput);
    const adapter = this.resolve(context);
    if (request.rail !== context.selectedRail || request.executionId !== context.executionId) throw new Error("Reconciliation identity does not match execution context.");
    const events: RuntimeExecutionEvent[] = [this.event("reconciliation.requested", context, { reconciliationReference: request.reconciliationReference })];
    let outcome: ReconciliationOutcome;
    try {
      outcome = await adapter.reconcile(request, operation);
    } catch (error) {
      outcome = Object.freeze({
        outcome: "unknown",
        observedAt: operation.invokedAt,
        failure: createExecutionFailure({
          code: "RECONCILIATION_FAILED",
          category: "reconciliation",
          stage: "reconciliation",
          phase: "reconciliation",
          sideEffect: "may_have_occurred",
          message: error instanceof Error ? error.message : "Unexpected reconciliation failure.",
          retryable: false,
          occurredAt: operation.invokedAt,
          correlationId: operation.correlationId,
        }),
      });
    }
    const observation = reconciliationObservation(request, outcome);
    events.push(this.event(`reconciliation.${outcome.outcome}`, context, { outcome: outcome.outcome }));
    const failure = outcome.outcome === "failed" || outcome.outcome === "unknown" ? outcome.failure : undefined;
    const recovery = failure ? recommendRecovery({ failure }) : undefined;
    if (recovery) events.push(this.event("recovery.recommended", context, recoveryEventPayload(recovery)));
    return Object.freeze({ outcome, observation, recovery, events: Object.freeze(events) });
  }

  createReceiptEvent(context: CanonicalExecutionContext, receiptId: string): RuntimeExecutionEvent {
    return this.event("receipt.created", context, { receiptId });
  }

  private resolve(context: CanonicalExecutionContext): CanonicalPaymentRailAdapter {
    const adapter = this.adapters.get(context.selectedRail);
    if (!adapter || adapter.rail !== context.selectedRail) {
      throw createExecutionFailure({ code: "CONFIGURATION_ERROR", category: "configuration", stage: "adapter", phase: "pre_submission", sideEffect: "impossible", message: `No canonical adapter registered for rail ${context.selectedRail}.`, retryable: false, occurredAt: context.requestedAt, correlationId: context.correlationId });
    }
    return adapter;
  }

  private submissionResult(context: CanonicalExecutionContext, outcome: SubmissionOutcome, events: RuntimeExecutionEvent[]): SubmissionResult {
    events.push(this.event(`submission.${outcome.outcome}`, context, { outcome: outcome.outcome }));
    const observation = submissionObservation(outcome);
    const recovery = (outcome.outcome === "rejected" || outcome.outcome === "unknown") ? recommendRecovery({ failure: outcome.failure }) : undefined;
    if (recovery) events.push(this.event("recovery.recommended", context, recoveryEventPayload(recovery)));
    return Object.freeze({ outcome, ...(observation ? { observation } : {}), ...(recovery ? { recovery } : {}), events: Object.freeze(events) });
  }

  private event(type: Parameters<typeof createRuntimeExecutionEvent>[0], context: CanonicalExecutionContext, payload: Parameters<typeof createRuntimeExecutionEvent>[2]) {
    return createRuntimeExecutionEvent(type, context, payload, this.eventDependencies);
  }
}

function submissionObservation(outcome: SubmissionOutcome): SettlementObservation | undefined {
  if (outcome.outcome === "settled") return Object.freeze({ outcome: "settled", providerReference: outcome.providerReference, settledAt: outcome.settledAt, observedAt: outcome.settledAt, evidence: outcome.evidence });
  if (outcome.outcome === "unknown") return Object.freeze({ outcome: "unknown", reconciliationReference: outcome.reconciliationReference, observedAt: outcome.observedAt, failure: outcome.failure, evidence: outcome.evidence });
  return undefined;
}

function reconciliationObservation(request: ReconciliationRequest, outcome: ReconciliationOutcome): SettlementObservation {
  if (outcome.outcome === "settled") return Object.freeze({ outcome: "settled", providerReference: outcome.providerReference, settledAt: outcome.settledAt, observedAt: outcome.observedAt, evidence: outcome.evidence });
  if (outcome.outcome === "failed") return Object.freeze({ outcome: "failed", providerReference: outcome.providerReference, failedAt: outcome.failedAt, observedAt: outcome.observedAt, failure: outcome.failure, evidence: outcome.evidence });
  if (outcome.outcome === "unknown") return Object.freeze({ outcome: "unknown", reconciliationReference: request.reconciliationReference, observedAt: outcome.observedAt, failure: outcome.failure, evidence: outcome.evidence });
  return Object.freeze({ outcome: "pending", providerReference: request.providerReference, observedAt: outcome.observedAt, evidence: outcome.evidence });
}

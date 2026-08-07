import type { ExecutionFailure } from "../resilience/executionRecovery";
import type { ProviderReference, ReconciliationReference } from "./identifiers";
import type { RailEvidence } from "./railEvidence";

export type SettlementObservation<E extends RailEvidence = RailEvidence> =
  | Readonly<{
      outcome: "pending";
      providerReference?: ProviderReference;
      observedAt: string;
      evidence?: E;
    }>
  | Readonly<{
      outcome: "settled";
      providerReference: ProviderReference;
      settledAt: string;
      observedAt: string;
      evidence: E;
    }>
  | Readonly<{
      outcome: "failed";
      providerReference?: ProviderReference;
      failedAt: string;
      observedAt: string;
      failure: ExecutionFailure;
      evidence: E;
    }>
  | Readonly<{
      outcome: "unknown";
      reconciliationReference: ReconciliationReference;
      observedAt: string;
      failure?: ExecutionFailure;
      evidence?: E;
    }>;

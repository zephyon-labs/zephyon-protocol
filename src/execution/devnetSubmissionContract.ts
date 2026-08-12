import type { CanonicalSolanaPreparedSubmission } from "./canonicalSolanaRail";

export const DEVNET_SUBMISSION_STATES = [
  "PREPARING",
  "PREPARED_NOT_CONTACTED",
  "SUBMISSION_COMMITTED_RECONCILE_ONLY",
  "ACCEPTED_PENDING",
  "SETTLED",
  "FAILED",
  "UNKNOWN_RECONCILIATION_REQUIRED",
] as const;

export type DevnetSubmissionState = typeof DEVNET_SUBMISSION_STATES[number];
export type DevnetProviderContactCertainty = "NOT_STARTED" | "MAY_HAVE_OCCURRED" | "ACCEPTED";

export type DevnetSubmissionCommitment = Readonly<{
  state: "SUBMISSION_COMMITTED_RECONCILE_ONLY";
  commitmentId: string;
  executionId: string;
  signature: string;
  signedTransactionDigest: string;
  committedAt: string;
}>;

export type CommittedCanonicalSolanaPreparedSubmission = CanonicalSolanaPreparedSubmission & Readonly<{
  payload: CanonicalSolanaPreparedSubmission["payload"] & Readonly<{
    submissionCommitment: DevnetSubmissionCommitment;
  }>;
}>;

/**
 * Attaches the backend's durable post-commit attestation. This function does not
 * perform persistence; callers MUST invoke it only after the database commit.
 */
export function authorizeCommittedDevnetSubmission(
  prepared: CanonicalSolanaPreparedSubmission,
  commitment: DevnetSubmissionCommitment,
): CommittedCanonicalSolanaPreparedSubmission {
  if (commitment.state !== "SUBMISSION_COMMITTED_RECONCILE_ONLY") throw new Error("Devnet submission requires the reconciliation-only durable state.");
  if (!commitment.commitmentId.trim()) throw new Error("Devnet submission commitmentId is required.");
  if (!isCanonicalTimestamp(commitment.committedAt)) throw new Error("Devnet submission committedAt must be a canonical UTC timestamp.");
  if (commitment.executionId !== prepared.executionId || commitment.signature !== prepared.payload.signature ||
      commitment.signedTransactionDigest !== prepared.payload.signedTransactionDigest) {
    throw new Error("Devnet submission commitment does not match the immutable prepared artifact.");
  }
  return Object.freeze({ ...prepared, payload: Object.freeze({ ...prepared.payload, submissionCommitment: Object.freeze({ ...commitment }) }) });
}

export type DevnetBlockhashDisposition = "VALID" | "SAFE_TO_PREPARE_FRESH" | "RECONCILIATION_REQUIRED";

export function classifyDevnetBlockhash(
  state: DevnetSubmissionState,
  lastValidBlockHeight: string,
  currentBlockHeight: string,
): DevnetBlockhashDisposition {
  const lastValid = parseHeight(lastValidBlockHeight, "lastValidBlockHeight");
  const current = parseHeight(currentBlockHeight, "currentBlockHeight");
  if (current <= lastValid) return "VALID";
  if (state === "PREPARING" || state === "PREPARED_NOT_CONTACTED") return "SAFE_TO_PREPARE_FRESH";
  return "RECONCILIATION_REQUIRED";
}

export function assertCommittedDevnetSubmission(value: CanonicalSolanaPreparedSubmission): asserts value is CommittedCanonicalSolanaPreparedSubmission {
  const commitment = value.payload.submissionCommitment as DevnetSubmissionCommitment | undefined;
  if (!commitment) throw new Error("External Devnet submission is forbidden before the durable reconciliation-only commitment.");
  authorizeCommittedDevnetSubmission(value, commitment);
}

function parseHeight(value: string, name: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${name} must be a canonical non-negative integer string.`);
  return BigInt(value);
}

function isCanonicalTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value;
}

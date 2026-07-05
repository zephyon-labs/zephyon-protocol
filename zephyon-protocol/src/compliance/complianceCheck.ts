import type { IsoTimestamp } from "../shared/time";

export type ComplianceCheckType =
  | "kyc"
  | "kyb"
  | "sanctions"
  | "aml"
  | "transaction_monitoring";

export type ComplianceCheckStatus =
  | "pending"
  | "passed"
  | "failed"
  | "manual_review"
  | "not_required";

export type ComplianceCheck = {
  type: ComplianceCheckType;
  status: ComplianceCheckStatus;
  checkedAt?: IsoTimestamp;
  provider?: string;
  referenceId?: string;
  notes?: string;
};
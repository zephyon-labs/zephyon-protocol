export type RuntimeEventStage =
  | "runtime"
  | "identity"
  | "compliance"
  | "risk"
  | "policy"
  | "orchestration"
  | "settlement"
  | "transaction"
  | "receipt"
  | "treasury"
  | "payment";

export type RuntimeEventStatus =
  | "started"
  | "completed"
  | "failed"
  | "retrying"
  | "warning";

export const RuntimeEventType = {
  RuntimeStarted: "RUNTIME_STARTED",
  RuntimeCompleted: "RUNTIME_COMPLETED",
  RuntimeFailed: "RUNTIME_FAILED",

  IdentityStarted: "IDENTITY_STARTED",
  IdentityCompleted: "IDENTITY_COMPLETED",
  IdentityFailed: "IDENTITY_FAILED",

  ComplianceStarted: "COMPLIANCE_STARTED",
  ComplianceCompleted: "COMPLIANCE_COMPLETED",
  ComplianceFailed: "COMPLIANCE_FAILED",

  RiskStarted: "RISK_STARTED",
  RiskCompleted: "RISK_COMPLETED",
  RiskFailed: "RISK_FAILED",

  PolicyStarted: "POLICY_STARTED",
  PolicyCompleted: "POLICY_COMPLETED",
  PolicyFailed: "POLICY_FAILED",

  OrchestrationStarted: "ORCHESTRATION_STARTED",
  OrchestrationCompleted: "ORCHESTRATION_COMPLETED",
  OrchestrationFailed: "ORCHESTRATION_FAILED",

  SettlementStarted: "SETTLEMENT_STARTED",
  SettlementCompleted: "SETTLEMENT_COMPLETED",
  SettlementFailed: "SETTLEMENT_FAILED",

  TransactionSubmitted: "TRANSACTION_SUBMITTED",
  TransactionAccepted: "TRANSACTION_ACCEPTED",
  TransactionConfirmed: "TRANSACTION_CONFIRMED",
  TransactionFinalized: "TRANSACTION_FINALIZED",
  TransactionFailed: "TRANSACTION_FAILED",

  ReceiptCreated: "RECEIPT_CREATED",
  TreasuryUpdated: "TREASURY_UPDATED",

  PaymentCompleted: "PAYMENT_COMPLETED",
  PaymentFailed: "PAYMENT_FAILED",
} as const;

export type RuntimeEventType =
  (typeof RuntimeEventType)[keyof typeof RuntimeEventType];
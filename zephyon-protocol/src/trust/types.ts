export enum TrustSubjectType {
  HUMAN = "human",
  MERCHANT = "merchant",
  BUSINESS = "business",
  DEVELOPER = "developer",
  AGENT = "agent",
  PROTOCOL = "protocol",
}

export enum TrustSignalType {
  SETTLEMENT_SUCCEEDED = "settlement_succeeded",
  SETTLEMENT_FAILED = "settlement_failed",

  PAYMENT_SENT = "payment_sent",
  PAYMENT_RECEIVED = "payment_received",

  MERCHANT_VERIFIED = "merchant_verified",
  BUSINESS_VERIFIED = "business_verified",

  RECEIPT_VERIFIED = "receipt_verified",

  ACCOUNT_CREATED = "account_created",
  ACCOUNT_AGE_MILESTONE = "account_age_milestone",

  SUBSCRIPTION_STARTED = "subscription_started",
  SUBSCRIPTION_RENEWED = "subscription_renewed",

  DISPUTE_OPENED = "dispute_opened",
  DISPUTE_RESOLVED = "dispute_resolved",

  FRAUD_DETECTED = "fraud_detected",

  AGENT_TASK_COMPLETED = "agent_task_completed",
  AGENT_TASK_FAILED = "agent_task_failed",

  DEVELOPER_CONTRIBUTION = "developer_contribution",

  MANUAL_REVIEW_APPROVED = "manual_review_approved",
  MANUAL_REVIEW_REJECTED = "manual_review_rejected",
}

export interface TrustSignal {
  id: string;
  subjectId: string;
  subjectType: TrustSubjectType;
  signalType: TrustSignalType;
  timestamp: string;
  confidenceWeight: number;
  source: string;
  metadata?: Record<string, unknown>;
}
export type RiskFactorType =
  | "amount"
  | "velocity"
  | "new_recipient"
  | "new_device"
  | "identity_status"
  | "merchant_category"
  | "agent_autonomy"
  | "jurisdiction"
  | "settlement_rail"
  | "historical_behavior";

export type RiskFactorSeverity =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type RiskFactor = {
  type: RiskFactorType;
  severity: RiskFactorSeverity;
  scoreImpact: number;
  description: string;
};
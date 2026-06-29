export enum ParticipantType {
  HUMAN = "human",
  MERCHANT = "merchant",
  BUSINESS = "business",
  AI_AGENT = "ai_agent",
}

export enum ParticipantStatus {
  PENDING = "pending",
  ACTIVE = "active",
  SUSPENDED = "suspended",
  CLOSED = "closed",
}

export enum VerificationStatus {
  UNVERIFIED = "unverified",
  EMAIL_VERIFIED = "email_verified",
  PHONE_VERIFIED = "phone_verified",
  IDENTITY_VERIFIED = "identity_verified",
  BUSINESS_VERIFIED = "business_verified",
}

export enum SubscriptionTier {
  FREE = "free",
  PREMIUM = "premium",
  ENTERPRISE = "enterprise",
}

export type ContactInfo = {
  email?: string;
  phone?: string;
};

export type WalletConnection = {
  address: string;
  network: "solana" | "ethereum" | "bitcoin" | "other";
  label?: string;
  isPrimary: boolean;
  connectedAt: string;
};

export type PaymentMethod = {
  id: string;
  type: "wallet" | "bank" | "card" | "external";
  label?: string;
  isDefault: boolean;
  createdAt: string;
};

export type TrustSnapshot = {
  score: number;
  tier: "new" | "trusted" | "high_trust" | "restricted";
  lastAssessedAt?: string;
};

export type EconomicState = {
  lifetimeVolumeUsd: number;
  lifetimeFeesPaidUsd: number;
  paymentCount: number;
  merchantPaymentCount: number;
  agentPaymentCount: number;
};

export type ParticipantPreferences = {
  preferredCurrency: "USD" | "USDC" | "ZERA";
  preferredNetwork: "solana";
  notificationsEnabled: boolean;
};

export type ParticipantPermissions = {
  canSendPayments: boolean;
  canReceivePayments: boolean;
  canUseAiPayments: boolean;
  canAccessMerchantTools: boolean;
};

export type Participant = {
  id: string;
  displayName: string;
  participantType: ParticipantType;
  status: ParticipantStatus;
  contactInfo: ContactInfo;
  verificationStatus: VerificationStatus;
  subscriptionTier: SubscriptionTier;
  wallets: WalletConnection[];
  paymentMethods: PaymentMethod[];
  trustSnapshot: TrustSnapshot;
  economicState: EconomicState;
  preferences: ParticipantPreferences;
  permissions: ParticipantPermissions;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type OnboardingRequest = {
  displayName: string;
  participantType: ParticipantType;
  email?: string;
  phone?: string;
};

export type OnboardingResult = {
  participant: Participant;
  message: string;
};
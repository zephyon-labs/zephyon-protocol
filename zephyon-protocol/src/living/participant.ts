import {
  EconomicState,
  Participant,
  ParticipantPermissions,
  ParticipantPreferences,
  ParticipantStatus,
  ParticipantType,
  SubscriptionTier,
  TrustSnapshot,
  VerificationStatus,
} from "./types";

type CreateParticipantParams = {
  id: string;
  displayName: string;
  type: ParticipantType;
  email?: string;
  phone?: string;
};

export function createParticipant(
  params: CreateParticipantParams
): Participant {
  const now = new Date().toISOString();

  return {
    id: params.id,
    displayName: params.displayName,
    participantType: params.type,
    status: ParticipantStatus.PENDING,
    contactInfo: {
      email: params.email,
      phone: params.phone,
    },
    verificationStatus: VerificationStatus.UNVERIFIED,
    subscriptionTier: SubscriptionTier.FREE,
    wallets: [],
    paymentMethods: [],
    trustSnapshot: createDefaultTrustSnapshot(),
    economicState: createDefaultEconomicState(),
    preferences: createDefaultPreferences(),
    permissions: createDefaultPermissions(params.type),
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function activateParticipant(participant: Participant): Participant {
  return {
    ...participant,
    status: ParticipantStatus.ACTIVE,
    updatedAt: new Date().toISOString(),
  };
}

export function suspendParticipant(participant: Participant): Participant {
  return {
    ...participant,
    status: ParticipantStatus.SUSPENDED,
    updatedAt: new Date().toISOString(),
  };
}

export function closeParticipant(participant: Participant): Participant {
  return {
    ...participant,
    status: ParticipantStatus.CLOSED,
    updatedAt: new Date().toISOString(),
  };
}

function createDefaultTrustSnapshot(): TrustSnapshot {
  return {
    score: 0,
    tier: "new",
  };
}

function createDefaultEconomicState(): EconomicState {
  return {
    lifetimeVolumeUsd: 0,
    lifetimeFeesPaidUsd: 0,
    paymentCount: 0,
    merchantPaymentCount: 0,
    agentPaymentCount: 0,
  };
}

function createDefaultPreferences(): ParticipantPreferences {
  return {
    preferredCurrency: "USDC",
    preferredNetwork: "solana",
    notificationsEnabled: true,
  };
}

function createDefaultPermissions(
  type: ParticipantType
): ParticipantPermissions {
  return {
    canSendPayments: true,
    canReceivePayments: true,
    canUseAiPayments: type === ParticipantType.AI_AGENT,
    canAccessMerchantTools:
      type === ParticipantType.MERCHANT ||
      type === ParticipantType.BUSINESS,
  };
}
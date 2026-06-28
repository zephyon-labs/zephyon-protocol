import { Participant, ParticipantStatus } from "./types";
import { TrustSubjectType } from "../trust";

export function createParticipant(params: {
  id: string;
  displayName: string;
  subjectType: TrustSubjectType;
  email?: string;
  phone?: string;
}): Participant {
  const now = new Date().toISOString();

  return {
    id: params.id,
    displayName: params.displayName,
    subjectType: params.subjectType,
    status: ParticipantStatus.PENDING,
    contactInfo: {
      email: params.email,
      phone: params.phone,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function activateParticipant(
  participant: Participant
): Participant {
  return {
    ...participant,
    status: ParticipantStatus.ACTIVE,
    updatedAt: new Date().toISOString(),
  };
}

export function suspendParticipant(
  participant: Participant
): Participant {
  return {
    ...participant,
    status: ParticipantStatus.SUSPENDED,
    updatedAt: new Date().toISOString(),
  };
}

export function closeParticipant(
  participant: Participant
): Participant {
  return {
    ...participant,
    status: ParticipantStatus.CLOSED,
    updatedAt: new Date().toISOString(),
  };
}
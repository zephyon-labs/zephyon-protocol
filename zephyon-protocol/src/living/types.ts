import { TrustSubjectType } from "../trust";

export enum ParticipantStatus {
  PENDING = "pending",
  ACTIVE = "active",
  SUSPENDED = "suspended",
  CLOSED = "closed",
}

export type ContactInfo = {
  email?: string;
  phone?: string;
};

export type Participant = {
  id: string;
  displayName: string;
  subjectType: TrustSubjectType;
  status: ParticipantStatus;
  contactInfo: ContactInfo;
  createdAt: string;
  updatedAt: string;
};

export type OnboardingRequest = {
  displayName: string;
  subjectType: TrustSubjectType;
  email?: string;
  phone?: string;
};

export type OnboardingResult = {
  participant: Participant;
  message: string;
};
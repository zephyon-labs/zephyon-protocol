import { Participant, ParticipantType } from "./types";

import type { PaymentEvent, EconomicResult } from "../economics/types";
import { processEconomicEvent } from "../economics/engine";

import {
  createTrustEvidence,
  createTrustSignalsFromEconomicEvent,
  evaluateTrust,
  type TrustAssessment,
  type TrustSignal,
  TrustSubjectType,
} from "../trust";

export type ParticipantPaymentRequest = {
  sender: Participant;
  receiver: Participant;
  amountUsd: number;
  protocolFeeRate: number;
};

export type ParticipantTrustResult = {
  participantId: string;
  trustSignals: TrustSignal[];
  trustAssessment: TrustAssessment;
};

export type ParticipantPaymentResult = {
  economicResult: EconomicResult;
  trustResults: ParticipantTrustResult[];
};

function mapParticipantTypeToTrustSubjectType(
  participantType: ParticipantType
): TrustSubjectType {
  switch (participantType) {
    case ParticipantType.AI_AGENT:
      return TrustSubjectType.AGENT;

    case ParticipantType.MERCHANT:
    case ParticipantType.BUSINESS:
      return TrustSubjectType.MERCHANT;

    case ParticipantType.HUMAN:
    default:
      return TrustSubjectType.HUMAN;
  }
}

function determinePaymentEventType(
  sender: Participant,
  receiver: Participant
): PaymentEvent["type"] {
  const senderTrustType = mapParticipantTypeToTrustSubjectType(
    sender.participantType
  );

  const receiverTrustType = mapParticipantTypeToTrustSubjectType(
    receiver.participantType
  );

  if (
    senderTrustType === TrustSubjectType.AGENT ||
    receiverTrustType === TrustSubjectType.AGENT
  ) {
    return "AGENT_PAYMENT_COMPLETED";
  }

  if (receiverTrustType === TrustSubjectType.MERCHANT) {
    return "MERCHANT_PAYMENT_COMPLETED";
  }

  return "P2P_PAYMENT_COMPLETED";
}

export function processParticipantPayment(
  request: ParticipantPaymentRequest
): ParticipantPaymentResult {
  const event: PaymentEvent = {
    type: determinePaymentEventType(request.sender, request.receiver),
    amountUsd: request.amountUsd,
    protocolFeeRate: request.protocolFeeRate,
    timestamp: new Date().toISOString(),
    sender: request.sender.id,
    receiver: request.receiver.id,
  };

  const economicResult = processEconomicEvent(event);

  const trustSignals = createTrustSignalsFromEconomicEvent({
    event,
    resolveSubjectType: (participantId) => {
      if (participantId === request.sender.id) {
        return mapParticipantTypeToTrustSubjectType(
          request.sender.participantType
        );
      }

      if (participantId === request.receiver.id) {
        return mapParticipantTypeToTrustSubjectType(
          request.receiver.participantType
        );
      }

      return TrustSubjectType.HUMAN;
    },
    source: "living-pipeline",
  });

  const participantTrustResults = [request.sender, request.receiver].map(
    (participant) => {
      const participantSignals = trustSignals.filter(
        (signal) => signal.subjectId === participant.id
      );

      const trustSubjectType = mapParticipantTypeToTrustSubjectType(
        participant.participantType
      );

      const evidence = createTrustEvidence(
        participant.id,
        trustSubjectType,
        participantSignals
      );

      return {
        participantId: participant.id,
        trustSignals: participantSignals,
        trustAssessment: evaluateTrust(evidence),
      };
    }
  );

  return {
    economicResult,
    trustResults: participantTrustResults,
  };
}

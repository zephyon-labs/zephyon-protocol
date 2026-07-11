import type { PaymentEvent } from "../../economics/types";

import { createTrustSignal } from "../signals";
import {
  TrustSignal,
  TrustSignalType,
  TrustSubjectType,
} from "../types";

type ResolveSubjectType = (
  participantId: string,
  event: PaymentEvent
) => TrustSubjectType;

interface CreateTrustSignalsFromEconomicEventParams {
  event: PaymentEvent;
  resolveSubjectType: ResolveSubjectType;
  source?: string;
}

function getSenderSignalType(event: PaymentEvent): TrustSignalType {
  if (event.type === "AGENT_PAYMENT_COMPLETED") {
    return TrustSignalType.AGENT_TASK_COMPLETED;
  }

  return TrustSignalType.PAYMENT_SENT;
}

function getReceiverSignalType(event: PaymentEvent): TrustSignalType {
  if (event.type === "AGENT_PAYMENT_COMPLETED") {
    return TrustSignalType.AGENT_TASK_COMPLETED;
  }

  return TrustSignalType.PAYMENT_RECEIVED;
}

function getSenderConfidenceWeight(event: PaymentEvent): number {
  if (event.type === "AGENT_PAYMENT_COMPLETED") {
    return 2;
  }

  return 1;
}

function getReceiverConfidenceWeight(event: PaymentEvent): number {
  if (
    event.type === "MERCHANT_PAYMENT_COMPLETED" ||
    event.type === "AGENT_PAYMENT_COMPLETED"
  ) {
    return 2;
  }

  return 1;
}

export function createTrustSignalsFromEconomicEvent({
  event,
  resolveSubjectType,
  source = "economic-event",
}: CreateTrustSignalsFromEconomicEventParams): TrustSignal[] {
  const signals: TrustSignal[] = [];

  if (event.sender) {
    signals.push(
      createTrustSignal({
        subjectId: event.sender,
        subjectType: resolveSubjectType(event.sender, event),
        signalType: getSenderSignalType(event),
        confidenceWeight: getSenderConfidenceWeight(event),
        source,
        metadata: {
          role: "sender",
          receiptId: event.receiptId,
          paymentType: event.type,
          amountUsd: event.amountUsd,
        },
      })
    );
  }

  if (event.receiver) {
    signals.push(
      createTrustSignal({
        subjectId: event.receiver,
        subjectType: resolveSubjectType(event.receiver, event),
        signalType: getReceiverSignalType(event),
        confidenceWeight: getReceiverConfidenceWeight(event),
        source,
        metadata: {
          role: "receiver",
          receiptId: event.receiptId,
          paymentType: event.type,
          amountUsd: event.amountUsd,
        },
      })
    );
  }

  return signals;
}
import type {
  RuntimeEventStage,
  RuntimeEventStatus,
  RuntimeEventType,
} from "./runtimeEventTypes";

export type RuntimeEventMetadata = Record<string, unknown>;

export type RuntimeEvent = {
  eventId: string;
  runtimeId: string;
  paymentId?: string;

  type: RuntimeEventType;
  stage: RuntimeEventStage;
  status: RuntimeEventStatus;

  timestamp: string;
  durationMs?: number;

  message?: string;
  metadata?: RuntimeEventMetadata;
};

export type CreateRuntimeEventInput = Omit<
  RuntimeEvent,
  "eventId" | "timestamp"
> & {
  eventId?: string;
  timestamp?: string;
};

export function createRuntimeEvent(
  input: CreateRuntimeEventInput,
): RuntimeEvent {
  return {
    eventId: input.eventId ?? createEventId(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    ...input,
  };
}

function createEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
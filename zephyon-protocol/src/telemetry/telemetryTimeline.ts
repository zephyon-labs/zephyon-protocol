import type { RuntimeEvent } from "../runtime/events";

export type TelemetryTimelineEntry = {
  eventId: string;
  type: RuntimeEvent["type"];
  stage: RuntimeEvent["stage"];
  status: RuntimeEvent["status"];
  timestamp: string;
  durationMs?: number;
  message?: string;
};

export type TelemetryTimeline = {
  runtimeId: string;
  paymentId?: string;
  entries: TelemetryTimelineEntry[];
};

export function createTelemetryTimeline(
  events: RuntimeEvent[],
): TelemetryTimeline[] {
  const timelinesByRuntimeId = new Map<string, RuntimeEvent[]>();

  for (const event of events) {
    const timeline = timelinesByRuntimeId.get(event.runtimeId) ?? [];

    timeline.push(event);

    timelinesByRuntimeId.set(event.runtimeId, timeline);
  }

  return Array.from(timelinesByRuntimeId.entries()).map(
    ([runtimeId, timelineEvents]) => {
      const sortedEvents = [...timelineEvents].sort((a, b) =>
        a.timestamp.localeCompare(b.timestamp),
      );

      return {
        runtimeId,
        paymentId: sortedEvents.find((event) => event.paymentId)?.paymentId,
        entries: sortedEvents.map((event) => ({
          eventId: event.eventId,
          type: event.type,
          stage: event.stage,
          status: event.status,
          timestamp: event.timestamp,
          durationMs: event.durationMs,
          message: event.message,
        })),
      };
    },
  );
}

export function createTelemetryTimelineForRuntime(
  events: RuntimeEvent[],
  runtimeId: string,
): TelemetryTimeline | undefined {
  return createTelemetryTimeline(events).find(
    (timeline) => timeline.runtimeId === runtimeId,
  );
}
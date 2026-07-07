import type { RuntimeEvent } from "../runtime/events";

export type TelemetrySnapshot = {
  totalEvents: number;
  completedEvents: number;
  failedEvents: number;
  warningEvents: number;
  retryingEvents: number;
  averageDurationMs: number;
  latestEvent?: RuntimeEvent;
};

export function createTelemetrySnapshot(
  events: RuntimeEvent[],
): TelemetrySnapshot {
  const completedEvents = events.filter(
    (event) => event.status === "completed",
  ).length;

  const failedEvents = events.filter((event) => event.status === "failed").length;

  const warningEvents = events.filter(
    (event) => event.status === "warning",
  ).length;

  const retryingEvents = events.filter(
    (event) => event.status === "retrying",
  ).length;

  const timedEvents = events.filter(
    (event): event is RuntimeEvent & { durationMs: number } =>
      typeof event.durationMs === "number",
  );

  const averageDurationMs =
    timedEvents.length === 0
      ? 0
      : timedEvents.reduce((sum, event) => sum + event.durationMs, 0) /
        timedEvents.length;

  return {
    totalEvents: events.length,
    completedEvents,
    failedEvents,
    warningEvents,
    retryingEvents,
    averageDurationMs,
    latestEvent:
  events.length > 0
    ? events[events.length - 1]
    : undefined,
  };
}
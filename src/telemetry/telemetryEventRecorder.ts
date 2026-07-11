import type { RuntimeEvent, RuntimeEventBus } from "../runtime/events";

export type TelemetryEventRecorderOptions = {
  maxEvents?: number;
};

export class TelemetryEventRecorder {
  private events: RuntimeEvent[] = [];
  private unsubscribe?: () => void;
  private readonly maxEvents: number;

  constructor(options: TelemetryEventRecorderOptions = {}) {
    this.maxEvents = options.maxEvents ?? 1_000;
  }

  attach(eventBus: RuntimeEventBus): void {
    this.unsubscribe?.();

    this.unsubscribe = eventBus.subscribe((event) => {
      this.record(event);
    });
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  record(event: RuntimeEvent): void {
    this.events.push(event);

    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  getEvents(): RuntimeEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

export function createTelemetryEventRecorder(
  options?: TelemetryEventRecorderOptions,
): TelemetryEventRecorder {
  return new TelemetryEventRecorder(options);
}
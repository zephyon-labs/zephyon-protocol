import type { RuntimeEvent } from "./runtimeEvent";

export type RuntimeEventListener = (
  event: RuntimeEvent,
) => void | Promise<void>;

export class RuntimeEventBus {
  private listeners = new Set<RuntimeEventListener>();
  private events: RuntimeEvent[] = [];

  publish(event: RuntimeEvent): void {
    this.events.push(event);

    for (const listener of this.listeners) {
      void listener(event);
    }
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  getEvents(): RuntimeEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

export function createRuntimeEventBus(): RuntimeEventBus {
  return new RuntimeEventBus();
}
import {
  createRuntimeEvent,
  type RuntimeEvent,
  type RuntimeEventMetadata,
} from "./runtimeEvent";
import type { RuntimeEventBus } from "./runtimeEventBus";
import type {
  RuntimeEventStage,
  RuntimeEventStatus,
  RuntimeEventType,
} from "./runtimeEventTypes";

export type RuntimeEventEmitterContext = {
  runtimeId: string;
  paymentId?: string;
};

export type RuntimeEventEmitterInput = {
  type: RuntimeEventType;
  stage: RuntimeEventStage;
  status: RuntimeEventStatus;
  message?: string;
  metadata?: RuntimeEventMetadata;
  durationMs?: number;
};

export class RuntimeEventEmitter {
  constructor(
    private readonly eventBus: RuntimeEventBus,
    private readonly context: RuntimeEventEmitterContext,
  ) {}

  emit(input: RuntimeEventEmitterInput): RuntimeEvent {
    const event = createRuntimeEvent({
      runtimeId: this.context.runtimeId,
      paymentId: this.context.paymentId,
      ...input,
    });

    this.eventBus.publish(event);

    return event;
  }

  async measure<T>(
    input: Omit<RuntimeEventEmitterInput, "durationMs" | "status" | "type"> & {
      startedType: RuntimeEventType;
      completedType: RuntimeEventType;
      failedType: RuntimeEventType;
    },
    operation: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();

    this.emit({
      type: input.startedType,
      stage: input.stage,
      status: "started",
      message: input.message,
      metadata: input.metadata,
    });

    try {
      const result = await operation();
      const durationMs = Date.now() - startedAt;

      this.emit({
        type: input.completedType,
        stage: input.stage,
        status: "completed",
        durationMs,
        metadata: input.metadata,
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt;

      this.emit({
        type: input.failedType,
        stage: input.stage,
        status: "failed",
        durationMs,
        message: error instanceof Error ? error.message : "Unknown runtime error",
        metadata: {
          ...input.metadata,
          error,
        },
      });

      throw error;
    }
  }
}

export function createRuntimeEventEmitter(
  eventBus: RuntimeEventBus,
  context: RuntimeEventEmitterContext,
): RuntimeEventEmitter {
  return new RuntimeEventEmitter(eventBus, context);
}
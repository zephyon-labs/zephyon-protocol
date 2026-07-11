import { createPaymentRuntime, type ExecutionContext } from "../src/runtime";
import {
  createTelemetryEventRecorder,
  createTelemetrySnapshot,
  createTelemetryTimelineForRuntime,
} from "../src/telemetry";
import type { PaymentIntent } from "../src/shared";

async function main() {
  const now = new Date().toISOString();

  const runtime = createPaymentRuntime();
  const recorder = createTelemetryEventRecorder({ maxEvents: 100 });

  recorder.attach(runtime.getEventBus());

  const intent = {
    id: "intent-observability-001",
    senderId: "zephdek",
    recipientId: "merchant-demo",
    recipientWallet: "internal-wallet-nova",
    mint: "USDC",
    amountRaw: 2500,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    money: {
      amount: 25,
      asset: "USDC",
    },
  } as PaymentIntent;

  const context: ExecutionContext = {
    requestId: "runtime-observability-smoke-001",
    requestedAt: now,
    environment: "devnet",
    paymentIntent: intent,
    participant: {
  id: "zephdek",
  participantType: "human",
  displayName: "Zephdek",
  createdAt: now,
},
    metadata: {
      memo: "Runtime observability smoke test",
    },
  };

  const result = await runtime.execute(context);

  const events = recorder.getEvents();
  const snapshot = createTelemetrySnapshot(events);
  const timeline = createTelemetryTimelineForRuntime(events, context.requestId);

  console.log("");
  console.log("========================================");
  console.log(" RUNTIME OBSERVABILITY SMOKE TEST");
  console.log("========================================");
  console.log("");

  console.log("Decision Status:", result.decision.status);
  console.log("Orchestration Status:", result.orchestration?.status ?? "N/A");
  console.log("");

  console.log("Telemetry Snapshot:");
  console.log(JSON.stringify(snapshot, null, 2));
  console.log("");

  console.log("Telemetry Timeline:");
  console.log(JSON.stringify(timeline, null, 2));
  console.log("");

  console.log("Raw Events:");
  console.log(JSON.stringify(events, null, 2));

  recorder.detach();
}

main().catch((error) => {
  console.error("Runtime observability smoke test failed:");
  console.error(error);
});
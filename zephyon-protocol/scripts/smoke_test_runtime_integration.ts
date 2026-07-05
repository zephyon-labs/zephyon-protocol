import {
  createPaymentRuntime,
  type ExecutionContext,
} from "../src/runtime";
import {
  TrustSubjectType,
  createTrustEvidence,
  createTrustSignal,
  TrustSignalType,
} from "../src/trust";
import type { PaymentIntent } from "../src/shared";
import type { ParticipantIdentity } from "../src/identity";

async function main() {
  const now = new Date().toISOString();

  const intent: PaymentIntent = {
    id: "intent-runtime-integration-001",
    type: "p2p",
    status: "draft",
    senderId: "sender-matt",
    recipientId: "recipient-nova",
    money: {
      amount: 25,
      asset: "USDC",
    },
    recipientWallet: "internal-wallet-nova",
    mint: "USDC",
    amountRaw: 2500,
    memo: "Runtime integration test",
    createdAt: now,
    updatedAt: now,
  };

  const participant: ParticipantIdentity = {
    id: "sender-matt",
    participantType: "human",
    displayName: "Matt",
    createdAt: now,
  };

  const trustSignal = createTrustSignal({
    subjectId: participant.id,
    subjectType: TrustSubjectType.HUMAN,
    signalType: TrustSignalType.ACCOUNT_CREATED,
    confidenceWeight: 5,
    source: "runtime-integration-test",
  });

  const trustEvidence = createTrustEvidence(
    participant.id,
    TrustSubjectType.HUMAN,
    [trustSignal]
  );

  const context: ExecutionContext = {
    requestId: "runtime-integration-test-001",
    requestedAt: now,
    environment: "local",
    paymentIntent: intent,
    participant,
    trustEvidence,
    metadata: {
      memo: "Full runtime integration test",
    },
  };

  const runtime = createPaymentRuntime();

  const result = await runtime.execute(context);

  console.log("");
  console.log("========================================");
  console.log(" ZEPHYON RUNTIME INTEGRATION TEST");
  console.log("========================================");
  console.log("");
  console.log("Decision Status:", result.decision.status);

  if (!result.orchestration) {
    console.log("Runtime stopped before orchestration.");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Orchestration Status:", result.orchestration.status);
  console.log("Rail:", result.orchestration.transaction.rail);
  console.log("Transaction Status:", result.orchestration.transaction.status);
  console.log(
    "Amount:",
    result.orchestration.transaction.amount,
    result.orchestration.transaction.currency
  );

  console.log("");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("Runtime integration test failed:");
  console.error(error);

});
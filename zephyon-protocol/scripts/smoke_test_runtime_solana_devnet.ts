import { Connection, clusterApiUrl } from "@solana/web3.js";
import {
  ComplianceEngine,
  type ComplianceService,
} from "../src/compliance";
import {
  IdentityEngine,
  type IdentityService,
} from "../src/identity";
import {
  PolicyEngine,
  type PolicyService,
} from "../src/policy";
import {
  RiskEngine,
  type RiskService,
} from "../src/risk";
import {
  InMemoryPaymentAdapterRegistry,
  PaymentOrchestrator,
  resolvePaymentRail,
  validatePaymentIntent,
  type PaymentIntent,
} from "../src/shared";
import {
  SolanaPaymentAdapter,
  executeZephyonDevnetSplPay,
} from "../src/adapters";
import { PaymentDecisionPipeline, PaymentRuntime } from "../src/runtime";
import {
  createTelemetryEventRecorder,
  createTelemetrySnapshot,
  createTelemetryTimelineForRuntime,
} from "../src/telemetry";

const mintArg = process.argv[2];
const recipientArg = process.argv[3];
const amountRawArg = process.argv[4];

if (!mintArg || !recipientArg || !amountRawArg) {
  console.error(
    "Usage: npx ts-node scripts/smoke_test_runtime_solana_devnet.ts <MINT_PUBKEY> <RECIPIENT_PUBKEY> <AMOUNT_RAW>",
  );
  process.exit(1);
}

const amountRaw = Number(amountRawArg);

if (!Number.isFinite(amountRaw) || amountRaw <= 0 || !Number.isInteger(amountRaw)) {
  console.error("Amount raw must be a positive integer.");
  process.exit(1);
}

const approvingComplianceService: ComplianceService = {
  async evaluate() {
    return {
      status: "approved",
      reason: "approved_by_policy",
      decidedAt: new Date().toISOString(),
    };
  },
};

const approvingRiskService: RiskService = {
  async evaluate() {
    return {
      status: "approved",
      decidedAt: new Date().toISOString(),
      assessment: {
        score: 5,
        level: "low",
        assessedAt: new Date().toISOString(),
        factors: [],
      },
      reason: "Low-risk Solana devnet runtime test.",
    };
  },
};

const approvingPolicyService: PolicyService = {
  async evaluate() {
    return {
      status: "approved",
      decidedAt: new Date().toISOString(),
      results: [],
      reason: "Approved by Solana devnet runtime test policy.",
    };
  },
};

const approvingIdentityService: IdentityService = {
  async verify() {
    return {
      successful: true,
      identity: {
        level: "basic",
        verifiedAt: new Date().toISOString(),
        provider: "zephyon-devnet-runtime",
      },
      referenceId: `identity-${crypto.randomUUID()}`,
    };
  },
};

async function main() {
  const now = new Date().toISOString();
  const requestId = "runtime-solana-devnet-smoke-001";

  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  const registry = new InMemoryPaymentAdapterRegistry();

  registry.register(
    new SolanaPaymentAdapter({
      network: "solana",
      executeTransfer: (request) => executeZephyonDevnetSplPay(request),
      confirmTransfer: async (request) => {
        const status = await connection.getSignatureStatus(request.signature, {
          searchTransactionHistory: true,
        });

        if (!status.value) {
          throw new Error(`No Solana signature status found: ${request.signature}`);
        }

        if (status.value.err) {
          throw new Error(
            `Solana transaction failed: ${JSON.stringify(status.value.err)}`,
          );
        }

        return {
          signature: request.signature,
          settledAt: new Date().toISOString(),
          slot: status.value.slot,
          confirmationCount:
            status.value.confirmationStatus === "finalized"
              ? 32
              : status.value.confirmationStatus === "confirmed"
                ? 1
                : 0,
        };
      },
    }),
  );

  const decisionPipeline = new PaymentDecisionPipeline({
    identityEngine: new IdentityEngine(approvingIdentityService),
    complianceEngine: new ComplianceEngine(approvingComplianceService),
    riskEngine: new RiskEngine(approvingRiskService),
    policyEngine: new PolicyEngine(approvingPolicyService),
  });

  const orchestrator = new PaymentOrchestrator({
    clock: () => new Date().toISOString(),
    createTransactionId: () => `txn-${crypto.randomUUID()}`,

    validateIntent: (paymentIntent) => {
      const validation = validatePaymentIntent(paymentIntent);

      if (validation.isValid) {
        return { valid: true };
      }

      return {
        valid: false,
        failure: {
          code: "PAYMENT_INTENT_INVALID",
          reason: validation.errors.join(" "),
          recoverable: false,
        },
      };
    },

    resolveRail: (paymentIntent) =>
      resolvePaymentRail({
        intent: paymentIntent,
        preferredRail: "solana",
        availableRails: registry.listRails(),
      }),

    executePayment: (paymentIntent, transaction) => {
      const adapter = registry.getAdapter(transaction.rail);
      return adapter.execute(paymentIntent, transaction);
    },

    monitorSettlement: (paymentIntent, transaction) => {
      const adapter = registry.getAdapter(transaction.rail);
      return adapter.monitorSettlement(paymentIntent, transaction);
    },

    recordHistory: (result) => {
      console.log("Runtime history recorder saw:", {
        status: result.status,
        transactionId: result.transaction.id,
        rail: result.transaction.rail,
        signature: result.transaction.blockchain?.signature,
      });
    },
  });

  const runtime = new PaymentRuntime(decisionPipeline, orchestrator);
  const recorder = createTelemetryEventRecorder({ maxEvents: 100 });
  recorder.attach(runtime.getEventBus());

  const intent = {
    id: "intent-solana-devnet-001",
    senderId: "zephdek",
    recipientId: "merchant-demo",
    recipientWallet: recipientArg,
    mint: mintArg,
    amountRaw,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    money: {
      amount: amountRaw,
      asset: "USDC",
    },
  } as PaymentIntent;

  const result = await runtime.execute({
    requestId,
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
      memo: "Runtime Solana devnet smoke test",
    },
  });

  const events = recorder.getEvents();
  const snapshot = createTelemetrySnapshot(events);
  const timeline = createTelemetryTimelineForRuntime(events, requestId);

  console.log("");
  console.log("========================================");
  console.log(" RUNTIME SOLANA DEVNET SMOKE TEST");
  console.log("========================================");
  console.log("");

  console.log("Decision Status:", result.decision.status);
  console.log("Orchestration Status:", result.orchestration?.status ?? "N/A");
  console.log("Rail:", result.orchestration?.transaction.rail ?? "N/A");
  console.log("Signature:", result.orchestration?.transaction.blockchain?.signature ?? "N/A");
  console.log("");

  console.log("Telemetry Snapshot:");
  console.log(JSON.stringify(snapshot, null, 2));
  console.log("");

  console.log("Telemetry Timeline:");
  console.log(JSON.stringify(timeline, null, 2));

  recorder.detach();
}

main().catch((error) => {
  console.error("Runtime Solana devnet smoke test failed:");
  console.error(error);
  process.exit(1);
});
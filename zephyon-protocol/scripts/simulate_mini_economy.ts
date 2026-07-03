import {
  bootstrapProtocolLab,
  createEconomicEventId,
  recordEconomicEvent,
  saveLedgerToJson,
  simulateScenario,
  summarizeLedger,
  type EconomicEventType,
  type PaymentScenario,
} from "../src/protocolLab";

const MINT = "2w2nqMemQzjwKMk3jEmtXnBqGBXGJLs8FNfb5Khb8E7J";

function getEventTypeForRecipient(recipientId: string): EconomicEventType {
  switch (recipientId) {
    case "luna":
      return "creator_tip";
    case "pixel-pizza":
      return "merchant_purchase";
    case "atlas-ai":
      return "agent_payment";
    case "bob":
    default:
      return "p2p_payment";
  }
}

async function main() {
  const lab = await bootstrapProtocolLab();

  console.log("Ledger ID          :", lab.ledger.id);
  console.log("Ledger Environment :", lab.ledger.environment);
  console.log("Ledger Created At  :", lab.ledger.createdAt);
  console.log("Ledger Entries     :", lab.ledger.entries.length);
  console.log("");

  const bob = lab.participants.find((participant) => participant.id === "bob");
  const luna = lab.participants.find((participant) => participant.id === "luna");
  const pixelPizza = lab.participants.find(
    (participant) => participant.id === "pixel-pizza"
  );
  const atlasAi = lab.participants.find(
    (participant) => participant.id === "atlas-ai"
  );

  if (!bob || !luna || !pixelPizza || !atlasAi) {
    throw new Error("Missing one or more required scenario participants.");
  }

  const scenario: PaymentScenario = {
    name: "Mini Economy Relationship Graph",
    description: "Mixed-value payment simulation across multiple economic actors.",
    delayMs: 2000,
    requests: [
      { mint: MINT, recipient: bob.wallet, amountRaw: 1 },
      { mint: MINT, recipient: luna.wallet, amountRaw: 5 },
      { mint: MINT, recipient: pixelPizza.wallet, amountRaw: 10 },
      { mint: MINT, recipient: atlasAi.wallet, amountRaw: 25 },
      { mint: MINT, recipient: bob.wallet, amountRaw: 50 },
      { mint: MINT, recipient: luna.wallet, amountRaw: 100 },
      { mint: MINT, recipient: pixelPizza.wallet, amountRaw: 250 },
      { mint: MINT, recipient: atlasAi.wallet, amountRaw: 500 },
      { mint: MINT, recipient: luna.wallet, amountRaw: 1000 },
      { mint: MINT, recipient: pixelPizza.wallet, amountRaw: 2500 },
    ],
  };

  const simulation = await simulateScenario(lab.environment, scenario);
  const result = simulation.result;

  scenario.requests.forEach((request, index) => {
    const recipient = lab.participants.find(
      (participant) => participant.wallet === request.recipient
    );

    if (!recipient) {
      throw new Error(`Missing recipient for wallet ${request.recipient}`);
    }

    recordEconomicEvent(lab.ledger, {
      id: createEconomicEventId(scenario.name, index),
      scenarioName: scenario.name,
      eventType: getEventTypeForRecipient(recipient.id),
      senderId: "treasury",
      recipientId: recipient.id,
      recipientWallet: recipient.wallet,
      mint: request.mint,
      amountRaw: request.amountRaw,
      status: "simulated",
      timestamp: new Date().toISOString(),
    });
  });

  const ledgerSummary = summarizeLedger(lab.ledger);
  const ledgerPath = saveLedgerToJson(lab.ledger);

  console.log("");
  console.log("========================================");
  console.log("     ZEPHYON MINI ECONOMY REPORT");
  console.log("========================================");
  console.log("");

  console.log(`Scenario          : ${simulation.scenarioName}`);
  console.log(`Description       : ${simulation.description}`);
  console.log(`Environment       : ${result.environment}`);
  console.log(`Total Payments    : ${result.total}`);
  console.log(`Delay             : ${result.delayMs} ms`);
  console.log(`Successful        : ${result.simulated}`);
  console.log(`Failed            : ${result.failed}`);
  console.log(`Blocked           : ${result.blocked}`);
  console.log(`Avg Compute Units : ${result.averageUnitsConsumed}`);
  console.log(`Min Compute Units : ${result.minUnitsConsumed ?? "N/A"}`);
  console.log(`Max Compute Units : ${result.maxUnitsConsumed ?? "N/A"}`);
  console.log(`Ledger Entries    : ${lab.ledger.entries.length}`);
  console.log(`Ledger Saved To   : ${ledgerPath}`);

  console.log("");
  console.log("-------- LEDGER SUMMARY --------");
  console.log(`Total Events      : ${ledgerSummary.totalEvents}`);
  console.log(`Total Raw Volume  : ${ledgerSummary.totalRawVolume}`);
  console.log(`P2P Payments      : ${ledgerSummary.byEventType.p2p_payment}`);
  console.log(`Creator Tips      : ${ledgerSummary.byEventType.creator_tip}`);
  console.log(`Merchant Purchases: ${ledgerSummary.byEventType.merchant_purchase}`);
  console.log(`Agent Payments    : ${ledgerSummary.byEventType.agent_payment}`);
  console.log(`Protocol Tests    : ${ledgerSummary.byEventType.protocol_test}`);

  console.log("");
  console.log("========================================");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
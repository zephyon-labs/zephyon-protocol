import { scenarioParticipants, getScenarioParticipant } from "../src/protocolLab";

function main() {
  console.log("");
  console.log("========================================");
  console.log("   ZEPHYON SCENARIO PARTICIPANTS");
  console.log("========================================");
  console.log("");

  for (const participant of scenarioParticipants) {
    const resolved = getScenarioParticipant(participant.id);

    console.log(`${resolved.name}`);
    console.log(`  ID     : ${resolved.id}`);
    console.log(`  Role   : ${resolved.role}`);
    console.log(`  Wallet : ${resolved.wallet}`);
    console.log("");
  }

  console.log("========================================");
}

main();
import { runProtocolLab } from "../src/protocolLab";

runProtocolLab().catch((error) => {
  console.error("Protocol Lab failed:");
  console.error(error);
  process.exit(1);
});
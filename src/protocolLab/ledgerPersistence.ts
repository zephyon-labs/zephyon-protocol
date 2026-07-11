import fs from "node:fs";
import path from "node:path";
import type { EconomicLedger } from "./economicLedger";

export type LedgerStorageMode = "memory" | "local-json";

export function getLedgerOutputDirectory(): string {
  return path.resolve(process.cwd(), "protocol-lab-ledgers");
}

export function saveLedgerToJson(ledger: EconomicLedger): string {
  const outputDirectory = getLedgerOutputDirectory();

  if (!fs.existsSync(outputDirectory)) {
    fs.mkdirSync(outputDirectory, { recursive: true });
  }

  const safeEnvironment = ledger.environment
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const filename = `${ledger.id}-${safeEnvironment}.json`;
  const filePath = path.join(outputDirectory, filename);

  fs.writeFileSync(filePath, JSON.stringify(ledger, null, 2), "utf8");

  return filePath;
}
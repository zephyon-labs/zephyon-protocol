import { copyJsonObject, type JsonObject } from "./json";
import { strictObject } from "./exactValues";

export type RailEvidence = Readonly<{
  type: string;
  version: number;
  data: JsonObject;
}>;

export function createRailEvidence(input: unknown): RailEvidence {
  const record = strictObject(input, ["type", "version", "data"], "railEvidence");
  if (typeof record.type !== "string" || !/^[a-z][a-z0-9._-]{0,63}$/.test(record.type)) {
    throw new Error("railEvidence.type must be a canonical evidence type.");
  }
  if (!Number.isSafeInteger(record.version) || Number(record.version) < 1) {
    throw new Error("railEvidence.version must be a positive safe integer.");
  }
  return Object.freeze({
    type: record.type,
    version: Number(record.version),
    data: copyJsonObject(record.data, "railEvidence.data"),
  });
}

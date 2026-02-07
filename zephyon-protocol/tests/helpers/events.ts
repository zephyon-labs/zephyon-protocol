import * as anchor from "@coral-xyz/anchor";

/**
 * Normalize event names to avoid casing / formatting mismatches
 * between IDL, coder, and test expectations.
 */
function normalizeEventName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/**
 * Parse all Anchor events from transaction logs.
 */
export function parseEventsFromLogs(
  program: anchor.Program<any>,
  logs: string[]
) {
  const parser = new anchor.EventParser(program.programId, program.coder);

  const decoded: Array<{ name: string; data: any }> = [];
  const names: string[] = [];

  const events: any = parser.parseLogs(logs);
  for (const evt of events) {
    names.push(evt.name);
    decoded.push({ name: evt.name, data: evt.data });
  }

  return { decoded, names };
}

/**
 * Find the first matching event from a list of candidate names.
 * Handles casing differences safely.
 */
export function findEvent(
  program: anchor.Program<any>,
  logs: string[],
  candidateNames: string[]
) {
  const { decoded, names } = parseEventsFromLogs(program, logs);

  const wanted = new Set(candidateNames.map(normalizeEventName));

  for (const evt of decoded) {
    if (wanted.has(normalizeEventName(evt.name))) {
      return {
        hit: evt.data,
        matchedName: evt.name,
        decodedNames: names,
      };
    }
  }

  return {
    hit: null as any,
    matchedName: null as any,
    decodedNames: names,
  };
}

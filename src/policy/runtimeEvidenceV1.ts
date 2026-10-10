import { canonicalJsonV1, freeze, id, object } from "../economic/validation";
import { RuntimePolicyInputErrorV1, type RuntimeEvidenceQualifierV1, type RuntimeEvidenceV1 } from "./runtimePolicyContractsV1";
import { evidenceRecord, guarded, list, unique } from "./runtimePolicyValidationV1";

type Snapshot = Readonly<{ authorityId: string; records: readonly Readonly<{ evidence: RuntimeEvidenceV1; authenticated: boolean }>[] }>;
const admission = Object.freeze({});
class EvidenceAuthority {
  readonly #id: string;
  readonly #authenticate: RuntimeEvidenceQualifierV1["authenticate"];
  constructor(token: object, qualifier: RuntimeEvidenceQualifierV1) {
    if (token !== admission) throw new RuntimePolicyInputErrorV1("EVIDENCE_QUALIFIER_REQUIRED");
    this.#id = qualifier.authorityId; this.#authenticate = qualifier.authenticate; Object.freeze(this);
  }
  static identity(value: unknown): string | undefined {
    return typeof value === "object" && value !== null && #id in value ? value.#id : undefined;
  }
  static async authenticate(authority: EvidenceAuthority, record: RuntimeEvidenceV1): Promise<boolean> {
    try { return await authority.#authenticate(record) === true; } catch { return false; }
  }
}
export type RuntimeEvidenceAuthorityV1 = EvidenceAuthority;
/** Establish once in trusted server composition, pin this exact capability into the evaluator.
 * A second capability with the same textual authority ID cannot impersonate it. */
export function createRuntimeEvidenceAuthorityV1(input: RuntimeEvidenceQualifierV1): RuntimeEvidenceAuthorityV1 {
  return guarded("EVIDENCE_QUALIFIER_REQUIRED", () => {
    const q = object(input, ["authorityId", "authenticate"]);
    if (typeof q.authenticate !== "function") throw new Error("Qualified ingestion callback required.");
    return new EvidenceAuthority(admission, { authorityId: id(q.authorityId), authenticate: q.authenticate as RuntimeEvidenceQualifierV1["authenticate"] });
  });
}
/** Opaque immutable value, not a structural JSON assertion of trust. No global mutable registry. */
class QualifiedEvidenceSet {
  readonly #snapshot: Snapshot;
  readonly #authority: EvidenceAuthority;
  constructor(token: object, snapshot: Snapshot, authority: EvidenceAuthority) {
    if (token !== admission) throw new RuntimePolicyInputErrorV1("EVIDENCE_QUALIFIER_REQUIRED");
    this.#snapshot = freeze(snapshot); this.#authority = authority; Object.freeze(this);
  }
  static read(value: unknown, authority: EvidenceAuthority): Snapshot | undefined {
    return typeof value === "object" && value !== null && #snapshot in value && value.#authority === authority ? value.#snapshot : undefined;
  }
}
export type RuntimeEvidenceSetV1 = QualifiedEvidenceSet;

/** Called only by trusted ingestion/composition. Authentication must cover the whole record,
 * including disposition and bindings. Do not expose this factory with caller-selected qualifiers.
 * A serialized set must be re-qualified on reconstruction; JSON cloning never preserves authority. */
export async function createRuntimeEvidenceSetV1(input: unknown, authority: RuntimeEvidenceAuthorityV1): Promise<RuntimeEvidenceSetV1> {
  const authorityId = EvidenceAuthority.identity(authority);
  if (!authorityId) throw new RuntimePolicyInputErrorV1("EVIDENCE_QUALIFIER_REQUIRED");
  const records = guarded("EVIDENCE_INVALID", () => {
    const parsed = unique(list(input, 8, 0).map(evidenceRecord), r => r.evidenceClass);
    unique([...parsed], r => r.evidenceId);
    canonicalJsonV1(parsed); return parsed;
  });
  const qualified: { evidence: RuntimeEvidenceV1; authenticated: boolean }[] = [];
  for (const evidence of records) {
    const authenticated = await EvidenceAuthority.authenticate(authority, evidence);
    qualified.push({ evidence, authenticated });
  }
  return new QualifiedEvidenceSet(admission, { authorityId, records: qualified }, authority);
}
// Internal only: not re-exported from the package root.
export const readRuntimeEvidenceSet = QualifiedEvidenceSet.read;
export const runtimeEvidenceAuthorityIdentity = EvidenceAuthority.identity;

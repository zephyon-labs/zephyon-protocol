import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { parseTimestamp } from "../execution/executionContext";
export function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        throw new Error("Expected a plain contract object.");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).some(k => typeof k !== "string") || Object.entries(descriptors).some(([k, d]) => !d.enumerable || !("value" in d) || ![...required, ...optional].includes(k)) || required.some(k => !Object.hasOwnProperty.call(value, k)))
        throw new Error("Missing, accessor, or unknown contract field.");
    return value as Record<string, unknown>;
}
export function literal<T extends string | number | boolean>(value: unknown, expected: T): T {
    if (value !== expected)
        throw new Error(`Expected contract value ${expected}.`);
    return expected;
}
export function choice<T extends string>(value: unknown, values: readonly T[]): T {
    if (typeof value !== "string" || !values.includes(value as T))
        throw new Error("Unsupported contract value.");
    return value as T;
}
export function id(value: unknown): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/|-]{0,127}$/.test(value))
        throw new Error("Expected a bounded ASCII identifier.");
    return value;
}
export function hex(value: unknown): string {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
        throw new Error("Expected lowercase SHA-256 hex.");
    return value;
}
export function integer(value: unknown, positive = false, max = 18446744073709551615n): string {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > max || (positive && value === "0"))
        throw new Error("Expected bounded canonical atomic integer string.");
    return value;
}
export function smallInteger(value: unknown, max: number, min = 0): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0) || value < min || value > max)
        throw new Error("Invalid integer metadata.");
    return value;
}
export function key(value: unknown): string {
    if (typeof value !== "string" || value.length > 44 || new PublicKey(value).toBase58() !== value)
        throw new Error("Expected canonical 32-byte base58 identity.");
    return value;
}
export function time(value: unknown): string { return parseTimestamp(value, "contract timestamp"); }
export function flag(value: unknown): boolean { if (typeof value !== "boolean")
    throw new Error("Expected boolean."); return value; }
/** Restricted canonical JSON, NOT arbitrary JSON/JCS. Wire inputs are parsed objects, not raw JSON text. */
export function canonicalJsonV1(value: unknown): string {
    let nodes = 0;
    function encode(v: unknown, depth: number): string {
        if (++nodes > 4096 || depth > 24)
            throw new Error("Contract exceeds serialization bounds.");
        if (v === null || typeof v === "boolean")
            return JSON.stringify(v);
        if (typeof v === "string") {
            if (!/^[\x20-\x7e]*$/.test(v) || v.length > 8192)
                throw new Error("Canonical strings must be bounded ASCII.");
            return JSON.stringify(v);
        }
        if (typeof v === "number") {
            smallInteger(v, Number.MAX_SAFE_INTEGER);
            return String(v);
        }
        if (Array.isArray(v)) {
            if (Object.keys(v).length !== v.length || v.some((_, i) => !Object.hasOwnProperty.call(v, i)))
                throw new Error("Sparse/extended arrays are unsupported.");
            return "[" + v.map(x => encode(x, depth + 1)).join(",") + "]";
        }
        if (v && typeof v === "object") {
            const keys = Object.keys(v).sort();
            object(v, keys);
            return "{" + keys.map(k => encode(k, depth + 1) + ":" + encode((v as Record<string, unknown>)[k], depth + 1)).join(",") + "}";
        }
        throw new Error("Unsupported canonical value.");
    }
    return encode(value, 0);
}
export function digest(domain: string, value: unknown): string { return createHash("sha256").update(domain + "\n" + canonicalJsonV1(value), "utf8").digest("hex"); }
export function freeze<T>(value: T): Readonly<T> {
    if (value && typeof value === "object") {
        Object.values(value).forEach(v => freeze(v));
        Object.freeze(value);
    }
    return value;
}

export type JsonPrimitive = null | boolean | number | string;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonObject = { readonly [key: string]: JsonValue };

export function copyJsonObject(value: unknown, name = "value"): JsonObject {
  const copied = copyJsonValue(value, name);
  if (!isPlainObject(copied)) {
    throw new Error(`${name} must be a JSON object.`);
  }
  return copied;
}

export function copyJsonValue(value: unknown, name = "value"): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${name} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item, index) => copyJsonValue(item, `${name}[${index}]`)));
  }
  if (isPlainObject(value)) {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) throw new Error(`${name}.${key} cannot be undefined.`);
      result[key] = copyJsonValue(item, `${name}.${key}`);
    }
    return Object.freeze(result);
  }
  throw new Error(`${name} must contain only JSON-safe values.`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const DECIMAL_INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/;
const DECIMAL_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;
const ASSET_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;

declare const decimalIntegerBrand: unique symbol;
declare const decimalAmountBrand: unique symbol;

export type DecimalIntegerString = string & { readonly [decimalIntegerBrand]: true };
export type DecimalAmountString = string & { readonly [decimalAmountBrand]: true };

export type ExactAmount = Readonly<{
  asset: string;
  units: DecimalIntegerString;
  decimals?: number;
}>;

export function parseDecimalInteger(value: unknown, name = "value"): DecimalIntegerString {
  if (typeof value !== "string" || !DECIMAL_INTEGER_PATTERN.test(value)) {
    throw new Error(`${name} must be a canonical non-negative decimal integer string.`);
  }
  return value as DecimalIntegerString;
}

export function parseDecimalAmount(value: unknown, name = "value"): DecimalAmountString {
  if (typeof value !== "string" || !DECIMAL_AMOUNT_PATTERN.test(value)) {
    throw new Error(`${name} must be a canonical non-negative decimal string.`);
  }
  return value as DecimalAmountString;
}

export function createExactAmount(input: unknown): ExactAmount {
  const record = strictObject(input, ["asset", "units", "decimals"], "amount");
  if (typeof record.asset !== "string" || !ASSET_PATTERN.test(record.asset)) {
    throw new Error("amount.asset must be a canonical asset identifier.");
  }
  if (record.decimals !== undefined &&
      (!Number.isSafeInteger(record.decimals) || Number(record.decimals) < 0 || Number(record.decimals) > 255)) {
    throw new Error("amount.decimals must be a safe integer between 0 and 255.");
  }
  return Object.freeze({
    asset: record.asset,
    units: parseDecimalInteger(record.units, "amount.units"),
    ...(record.decimals === undefined ? {} : { decimals: Number(record.decimals) }),
  });
}

export function exactUnitsAsBigInt(amount: ExactAmount): bigint {
  return BigInt(amount.units);
}

export function strictObject(
  value: unknown,
  allowedKeys: readonly string[],
  name: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const unknownKey = Object.keys(record).find((key) => !allowedKeys.includes(key));
  if (unknownKey) throw new Error(`${name} contains unsupported field: ${unknownKey}.`);
  return record;
}

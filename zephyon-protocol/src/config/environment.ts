import "dotenv/config";

export function getEnv(key: string): string | undefined {
  const value = process.env[key];

  if (!value) return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function requireEnv(key: string): string {
  const value = getEnv(key);

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

export function hasEnv(key: string): boolean {
  return getEnv(key) !== undefined;
}

export function maskSecret(value: string): string {
  if (!value) return "[REDACTED]";
  if (value.length <= 8) return "[REDACTED]";

  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

export function maskUrl(value: string): string {
  try {
    const parsed = new URL(value);

    return `${parsed.protocol}//${parsed.hostname}/[REDACTED]`;
  } catch {
    return "[REDACTED]";
  }
}
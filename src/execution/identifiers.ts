const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OPAQUE_REFERENCE_PATTERN = /^[\x21-\x7e]{1,512}$/;

declare const executionIdBrand: unique symbol;
declare const intentIdBrand: unique symbol;
declare const transactionIdBrand: unique symbol;
declare const requestIdBrand: unique symbol;
declare const correlationIdBrand: unique symbol;
declare const attemptIdBrand: unique symbol;
declare const providerReferenceBrand: unique symbol;
declare const providerIdempotencyKeyBrand: unique symbol;
declare const reconciliationReferenceBrand: unique symbol;

export type ExecutionId = string & { readonly [executionIdBrand]: true };
export type CanonicalPaymentIntentId = string & { readonly [intentIdBrand]: true };
export type TransactionId = string & { readonly [transactionIdBrand]: true };
export type RuntimeRequestId = string & { readonly [requestIdBrand]: true };
export type CorrelationId = string & { readonly [correlationIdBrand]: true };
export type AttemptId = string & { readonly [attemptIdBrand]: true };
export type ProviderReference = string & { readonly [providerReferenceBrand]: true };
export type ProviderIdempotencyKey = string & { readonly [providerIdempotencyKeyBrand]: true };
export type ReconciliationReference = string & { readonly [reconciliationReferenceBrand]: true };

export const parseExecutionId = (value: unknown) => parseIdentifier(value, "executionId") as ExecutionId;
export const parsePaymentIntentId = (value: unknown) => parseIdentifier(value, "paymentIntentId") as CanonicalPaymentIntentId;
export const parseTransactionId = (value: unknown) => parseIdentifier(value, "transactionId") as TransactionId;
export const parseRuntimeRequestId = (value: unknown) => parseIdentifier(value, "requestId") as RuntimeRequestId;
export const parseCorrelationId = (value: unknown) => parseIdentifier(value, "correlationId") as CorrelationId;
export const parseAttemptId = (value: unknown) => parseIdentifier(value, "attemptId") as AttemptId;
export const parseProviderReference = (value: unknown) => parseOpaque(value, "providerReference") as ProviderReference;
export const parseProviderIdempotencyKey = (value: unknown) => parseOpaque(value, "providerIdempotencyKey") as ProviderIdempotencyKey;
export const parseReconciliationReference = (value: unknown) => parseOpaque(value, "reconciliationReference") as ReconciliationReference;

export function parseCanonicalIdentifier(value: unknown, name = "identifier"): string {
  return parseIdentifier(value, name);
}

function parseIdentifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${name} must be a canonical identifier.`);
  }
  return value;
}

function parseOpaque(value: unknown, name: string): string {
  if (typeof value !== "string" || !OPAQUE_REFERENCE_PATTERN.test(value)) {
    throw new Error(`${name} must be a non-empty visible ASCII string.`);
  }
  return value;
}

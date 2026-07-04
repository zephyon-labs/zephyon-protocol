// src/adapters/internal/InternalLedgerAdapter.ts

import type {
  PaymentAdapterExecutionResult,
  PaymentAdapterHealth,
  PaymentAdapterSettlementResult,
  PaymentFeeEstimate,
  PaymentRailAdapter,
} from "../../shared/paymentAdapter";
import type { PaymentIntent } from "../../shared/paymentIntent";
import type { PaymentTransaction } from "../../shared/paymentTransaction";

export class InternalLedgerAdapter implements PaymentRailAdapter {
  readonly rail = "internal" as const;

  checkHealth(): PaymentAdapterHealth {
    const now = new Date().toISOString();

    return {
      rail: this.rail,
      status: "available",
      checkedAt: now,
      message: "Internal ledger adapter initialized.",
    };
  }

  estimateFees(
    _intent: PaymentIntent,
    _transaction: PaymentTransaction
  ): PaymentFeeEstimate {
    return {
      rail: this.rail,
      estimatedFeeAmount: 0,
      currency: _transaction.currency,
      estimatedAt: new Date().toISOString(),
    };
  }

  execute(
    _intent: PaymentIntent,
    _transaction: PaymentTransaction
  ): PaymentAdapterExecutionResult {
    const now = new Date().toISOString();

    return {
      submittedAt: now,
      externalReference: `internal-${_transaction.id}`,
    };
  }

  monitorSettlement(
    _intent: PaymentIntent,
    _transaction: PaymentTransaction
  ): PaymentAdapterSettlementResult {
    const now = new Date().toISOString();

    return {
      settledAt: now,
      externalReference: `internal-${_transaction.id}`,
    };
  }
}
import type { EconomicResult, PaymentEvent } from "./types";

export type AnalyticsSnapshot = {
  totalEvents: number;
  totalPaymentVolumeUsd: number;
  totalProtocolFeesUsd: number;
  averagePaymentUsd: number;
  p2pPayments: number;
  merchantPayments: number;
  agentPayments: number;
};

export class AnalyticsEngine {
  private events: EconomicResult[] = [];

  record(result: EconomicResult): void {
    this.events.push(result);
  }

  snapshot(): AnalyticsSnapshot {
    const totalEvents = this.events.length;

    const totalPaymentVolumeUsd = this.events.reduce(
      (sum, result) => sum + result.fee.amountUsd,
      0
    );

    const totalProtocolFeesUsd = this.events.reduce(
      (sum, result) => sum + result.fee.protocolFeeUsd,
      0
    );

    const averagePaymentUsd =
      totalEvents === 0 ? 0 : totalPaymentVolumeUsd / totalEvents;

    const countByType = (type: PaymentEvent["type"]) =>
      this.events.filter((result) => result.event.type === type).length;

    return {
      totalEvents,
      totalPaymentVolumeUsd,
      totalProtocolFeesUsd,
      averagePaymentUsd,
      p2pPayments: countByType("P2P_PAYMENT_COMPLETED"),
      merchantPayments: countByType("MERCHANT_PAYMENT_COMPLETED"),
      agentPayments: countByType("AGENT_PAYMENT_COMPLETED"),
    };
  }
}
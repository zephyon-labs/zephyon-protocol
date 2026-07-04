import type { PaymentRail } from "./paymentRail";
import type { PaymentRailAdapter } from "./paymentAdapter";

export type PaymentAdapterRegistry = {
  register(adapter: PaymentRailAdapter): void;
  getAdapter(rail: PaymentRail): PaymentRailAdapter;
  hasAdapter(rail: PaymentRail): boolean;
  listRails(): PaymentRail[];
};

export class InMemoryPaymentAdapterRegistry implements PaymentAdapterRegistry {
  private readonly adapters = new Map<PaymentRail, PaymentRailAdapter>();

  register(adapter: PaymentRailAdapter): void {
    this.adapters.set(adapter.rail, adapter);
  }

  getAdapter(rail: PaymentRail): PaymentRailAdapter {
    const adapter = this.adapters.get(rail);

    if (!adapter) {
      throw new Error(`No payment adapter registered for rail: ${rail}`);
    }

    return adapter;
  }

  hasAdapter(rail: PaymentRail): boolean {
    return this.adapters.has(rail);
  }

  listRails(): PaymentRail[] {
    return Array.from(this.adapters.keys());
  }
}
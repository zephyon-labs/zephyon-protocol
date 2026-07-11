import type { ParticipantId, WalletAddress } from "./identifiers";
import type { BlockchainNetwork } from "./blockchain";
import type { PaymentMethodType } from "./payment";
import type { IsoTimestamp } from "./time";

export type ContactInfo = {
  email?: string;
  phone?: string;
};

export type WalletConnection = {
  address: WalletAddress;
  network: BlockchainNetwork;
  label?: string;
  isPrimary: boolean;
  connectedAt: IsoTimestamp;
};

export type PaymentMethod = {
  id: string;
  type: PaymentMethodType;
  label?: string;
  isDefault: boolean;
  createdAt: IsoTimestamp;
};
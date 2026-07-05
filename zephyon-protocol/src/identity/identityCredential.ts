export type IdentityCredentialType =
  | "wallet"
  | "email"
  | "phone"
  | "government_id"
  | "business_registration"
  | "api_key"
  | "agent_certificate";

export type IdentityCredential = {
  type: IdentityCredentialType;
  value: string;
  verified: boolean;
};

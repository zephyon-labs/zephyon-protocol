import { Connection, PublicKey } from "@solana/web3.js";
import type { ProtocolEnvironment } from "./config";

export type TreasuryValidationStatus =
  | "valid"
  | "invalid"
  | "unconfigured"
  | "unavailable";

export type TreasuryValidationResult = {
  environmentName: string;
  cluster: string;
  treasuryPda?: string;
  status: TreasuryValidationStatus;
  exists: boolean;
  executable: boolean;
  owner?: string;
  lamports?: number;
  dataLength?: number;
  checkedAt: string;
  errors: string[];
};

export async function validateTreasuryAccount(
  environment: ProtocolEnvironment
): Promise<TreasuryValidationResult> {
  const errors: string[] = [];

  if (!environment.treasuryPda) {
    return {
      environmentName: environment.name,
      cluster: environment.cluster,
      treasuryPda: environment.treasuryPda,
      status: "unconfigured",
      exists: false,
      executable: false,
      checkedAt: new Date().toISOString(),
      errors: ["Treasury PDA is not configured for this environment."],
    };
  }

  const connection = new Connection(environment.rpcEndpoint.url, "confirmed");

  let exists = false;
  let executable = false;
  let owner: string | undefined;
  let lamports: number | undefined;
  let dataLength: number | undefined;
  let status: TreasuryValidationStatus = "unavailable";

  try {
    const treasuryPublicKey = new PublicKey(environment.treasuryPda);
    const accountInfo = await connection.getAccountInfo(treasuryPublicKey);

    if (!accountInfo) {
      errors.push("Treasury account not found.");
      status = "invalid";
    } else {
      exists = true;
      executable = accountInfo.executable;
      owner = accountInfo.owner.toBase58();
      lamports = accountInfo.lamports;
      dataLength = accountInfo.data.length;
      status = "valid";

      if (executable) {
        errors.push("Treasury account should not be executable.");
        status = "invalid";
      }
    }
  } catch (error) {
    errors.push(formatError(error));
    status = "unavailable";
  }

  return {
    environmentName: environment.name,
    cluster: environment.cluster,
    treasuryPda: environment.treasuryPda,
    status,
    exists,
    executable,
    owner,
    lamports,
    dataLength,
    checkedAt: new Date().toISOString(),
    errors,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
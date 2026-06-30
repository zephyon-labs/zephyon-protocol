import { Connection, PublicKey } from "@solana/web3.js";
import type { RpcEndpointConfig } from "./rpc";

export type ProgramValidationStatus = "valid" | "invalid" | "unavailable";

export type ProgramValidationConfig = {
  programId: string;
};

export type ProgramValidationResult = {
  programId: string;
  endpointLabel: string;
  environment: string;
  status: ProgramValidationStatus;
  exists: boolean;
  executable: boolean;
  owner?: string;
  lamports?: number;
  dataLength?: number;
  checkedAt: string;
  errors: string[];
};

export async function validateProgramAccount(
  endpoint: RpcEndpointConfig,
  config: ProgramValidationConfig
): Promise<ProgramValidationResult> {
  const connection = new Connection(endpoint.url, "confirmed");
  const errors: string[] = [];

  let exists = false;
  let executable = false;
  let owner: string | undefined;
  let lamports: number | undefined;
  let dataLength: number | undefined;
  let status: ProgramValidationStatus = "unavailable";

  try {
    const programPublicKey = new PublicKey(config.programId);
    const accountInfo = await connection.getAccountInfo(programPublicKey);

    if (!accountInfo) {
      errors.push("Program account not found.");
      status = "invalid";
    } else {
      exists = true;
      executable = accountInfo.executable;
      owner = accountInfo.owner.toBase58();
      lamports = accountInfo.lamports;
      dataLength = accountInfo.data.length;
      status = executable ? "valid" : "invalid";

      if (!executable) {
        errors.push("Program account exists but is not executable.");
      }
    }
  } catch (error) {
    errors.push(formatError(error));
    status = "unavailable";
  }

  return {
    programId: config.programId,
    endpointLabel: endpoint.label,
    environment: endpoint.environment,
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
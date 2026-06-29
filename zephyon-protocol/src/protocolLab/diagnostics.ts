import { defaultRpcEndpoints } from "./rpc";
import { checkRpcHealth, RpcHealthResult } from "./health";

export async function runRpcCompatibilityCheck(): Promise<RpcHealthResult[]> {
  return Promise.all(defaultRpcEndpoints.map(checkRpcHealth));
}
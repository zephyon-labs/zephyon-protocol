import { rpcEndpoints } from "./rpc";
import { checkRpcHealth, RpcHealthResult } from "./health";

export async function runRpcDiagnostics(): Promise<RpcHealthResult[]> {
  return Promise.all(rpcEndpoints.map(checkRpcHealth));
}
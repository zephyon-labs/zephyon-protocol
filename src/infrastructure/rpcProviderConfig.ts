import { getConfiguredRpcEndpoints } from "../config";
import type { RpcEndpoint } from "./rpcEndpoint";

export function createConfiguredRpcEndpoints(): RpcEndpoint[] {
  return getConfiguredRpcEndpoints();
}
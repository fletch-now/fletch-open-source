import type { MulticallCall, MulticallResult } from "./chain";

// viem wraps a successfully returned aggregate's failed subcalls with that
// token and function. An aggregate/network error instead names aggregate3.
export function failedTokenCall(result: MulticallResult, call: MulticallCall): boolean {
  if (result.status !== "failure" || !result.error || typeof result.error !== "object") return false;
  // viem's ESM and CJS exports can coexist under tsx; do not rely on class identity.
  const error = result.error as { name?: string; functionName?: string; contractAddress?: string };
  return error.name === "ContractFunctionExecutionError"
    && error.functionName === call.functionName
    && error.contractAddress?.toLowerCase() === call.address.toLowerCase();
}

export function metadataFailureSummary(results: readonly MulticallResult[], calls: readonly MulticallCall[]): { contractFailures: number; aggregateFailures: number; errorNames: string[] } {
  let contractFailures = 0;
  let aggregateFailures = 0;
  const names = new Set<string>();
  for (const [index, result] of results.entries()) {
    if (result.status === "success") continue;
    if (calls[index] && failedTokenCall(result, calls[index])) contractFailures++;
    else aggregateFailures++;
    let error = result.error;
    for (let depth = 0; error instanceof Error && depth < 4; depth++) {
      if (/^[A-Za-z]{1,64}$/.test(error.name)) names.add(error.name);
      error = error.cause;
    }
  }
  return { contractFailures, aggregateFailures, errorNames: [...names].slice(0, 8) };
}

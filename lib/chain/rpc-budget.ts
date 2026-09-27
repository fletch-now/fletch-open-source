// Count JSON-RPC methods, including provider batches, against the existing
// persistent daily bucket before entering the shared transport queue.
export function budgetedRpcFetch(fetchFn: typeof fetch, checkBudget: () => Promise<{ ok: boolean }>): typeof fetch {
  return async function fetchWithinBudget(input, init): Promise<Response> {
    let calls = 1;
    if (typeof init?.body === "string") {
      const body: unknown = JSON.parse(init.body);
      if (Array.isArray(body)) calls = Math.max(1, body.length);
    }
    for (let index = 0; index < calls; index++) {
      const verdict = await checkBudget();
      if (!verdict.ok) throw new Error("Daily RPC budget reached; metadata read deferred");
    }
    init?.signal?.throwIfAborted();
    return fetchFn(input, init);
  };
}

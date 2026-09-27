import { existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";

async function main(): Promise<void> {
  for (const path of ["/etc/fletch/fletch.env", ".env.local"]) if (existsSync(path)) loadEnv({ path, quiet: true });
  const { pool, close } = await import("@/lib/db");
  const { readPriorityUniverse, readPriorityPoolIds, refreshPriorityUniverse } = await import("@/lib/registry/priority");
  const { refreshPriorityHolders } = await import("@/lib/registry/priority-holders");
  const { readTokenMarkets } = await import("@/lib/registry/token-markets");
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const holderArgument = args.find((value) => value.startsWith("--holders="));
  const chainId = 4663;
  try {
    const migration = await pool.query("select to_regclass('registry_priority_tokens') as present");
    if (!migration.rows[0].present) throw new Error("Apply reviewed0055 and0056 migrations before this command");
    if (apply) {
      if (process.env.FLETCH_PRIORITY_REFRESH !== "1") throw new Error("Explicit FLETCH_PRIORITY_REFRESH=1 gate is required");
      if (holderArgument) {
        const addresses = [...new Set(holderArgument.slice("--holders=".length).split(",").map((address) => address.toLowerCase()))];
        if (addresses.length > 4 || addresses.some((address) => !/^0x[0-9a-f]{40}$/.test(address))) throw new Error("Supply at most4 exact priority token addresses");
        const membership = await readPriorityUniverse(chainId);
        if (addresses.some((address) => !membership.some((token) => token.address === address))) throw new Error("Holder targets must already belong to the reviewed priority universe");
        for (const address of addresses) console.log(JSON.stringify({ holders: await refreshPriorityHolders(chainId, address, { maxLogRequests: 40 }) }));
      } else {
        console.log(JSON.stringify({ refreshed: await refreshPriorityUniverse(chainId) }));
      }
    }
    const [universe, poolIds, markets] = await Promise.all([readPriorityUniverse(chainId), readPriorityPoolIds(chainId), readTokenMarkets(chainId)]);
    console.log(JSON.stringify({ mode: apply ? "applied_bounded_refresh" : "read_only", chainId, members: universe.length,
      listed: universe.filter((token) => token.role === "listed").length, community: universe.filter((token) => token.role === "community").length,
      poolIds, markets, limits: { candidatePools: 1200, communityPerMethod: 30, holderTokensPerRun: 4, holderLogRequestsPerToken: 40,
        holderMaxAddresses: 50000, holderMaxEvents: 500000 }, modelCalls: 0, signedTransactions: 0 }));
  } finally { await close(); }
}
main().catch(function failed(error: unknown) {
  // RPC errors can contain a keyed endpoint. Keep the operator log free of it.
  console.error(JSON.stringify({ ok: false, error: error instanceof Error && !/https?:\/\//.test(error.message) ? error.message.slice(0, 240) : "Priority refresh failed; previous complete observations retained" }));
  process.exitCode = 1;
});

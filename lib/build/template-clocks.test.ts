import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { QueryClient, QueryObserver, type QueryObserverOptions } from "@tanstack/react-query";
import { createPublicClient, custom, encodeAbiParameters, toFunctionSelector } from "viem";
import { robinhood, robinhoodTestnet } from "viem/chains";

type ClockOptions = QueryObserverOptions<bigint>;
interface Hooks { useChainBlockNumber: () => ClockOptions; useSolidityBlockNumber: () => ClockOptions; }

// Capture each real hook's query options, then execute them through TanStack
// Query and viem using an in-memory RPC transport. No chain requests are sent.
const bundled = build({
  stdin: { contents: 'export * from "./docker/webapp-template/foundation/reads";', resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
  plugins: [{ name: "controlled-clock-services", setup(plugin) {
    plugin.onResolve({ filter: /^(@tanstack\/react-query|\.\/network)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ loader: "js", contents: args.path === "./network"
      ? "export const appChain = fixture.appChain; export const publicClient = fixture.publicClient;"
      : "export function useQuery(options) { return options; }" }));
  } }],
});

for (const appChain of [robinhood, robinhoodTestnet]) {
  test(`foundation keeps RPC and Solidity deadline clocks separate on chain ${appChain.id}`, async function clocks() {
    const chainHeight = BigInt(116_000_000);
    const solidityHeight = BigInt(11_000_000);
    const deadline = solidityHeight + BigInt(1_200);
    const calls = { chain: 0, solidity: 0 };
    let failSolidity = false;
    const publicClient = createPublicClient({ chain: appChain, transport: custom({ async request({ method, params }) {
      if (method === "eth_blockNumber") {
        calls.chain++;
        return `0x${chainHeight.toString(16)}`;
      }
      assert.equal(method, "eth_call");
      const [request] = params as [{ to: string; data: string }];
      assert.equal(request.to.toLowerCase(), appChain.contracts.multicall3.address.toLowerCase());
      assert.equal(request.data, toFunctionSelector("getBlockNumber()"));
      calls.solidity++;
      if (failSolidity) throw new Error("Controlled Solidity clock failure");
      return encodeAbiParameters([{ type: "uint256" }], [solidityHeight]);
    } }, { retryCount: 0 }) });
    const compiled = { exports: {} as Hooks };
    new Function("require", "module", "exports", "fixture", (await bundled).outputFiles[0].text)(
      createRequire(`${process.cwd()}/package.json`), compiled, compiled.exports, { appChain, publicClient },
    );
    assert.equal("useBlockNumber" in compiled.exports, false);
    const chainOptions = compiled.exports.useChainBlockNumber();
    const solidityOptions = compiled.exports.useSolidityBlockNumber();
    assert.deepEqual(chainOptions.queryKey, ["chain-block", appChain.id]);
    assert.deepEqual(solidityOptions.queryKey, ["solidity-block", appChain.id]);
    assert.equal(chainOptions.refetchInterval, 30_000);
    assert.equal(solidityOptions.refetchInterval, 30_000);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const emptyClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    try {
      const chain = await new QueryObserver(client, chainOptions).refetch();
      const observer = new QueryObserver(client, solidityOptions);
      const solidity = await observer.refetch();
      assert.equal(chain.data, chainHeight);
      assert.equal(solidity.data, solidityHeight);
      assert.equal(solidity.isError, false);
      assert.ok(solidity.data! < deadline, "The contract's deadline is still open in its own block clock");
      assert.ok(chain.data! > deadline, "RPC height would incorrectly mark this deadline closed");
      const chainCalls = calls.chain;
      failSolidity = true;
      const failed = await observer.refetch();
      const deadlineActionEnabled = !failed.isError && failed.data !== undefined && failed.data < deadline;
      assert.equal(failed.isError, true);
      assert.equal(failed.data, solidityHeight, "TanStack retains only the earlier same-clock value on refetch failure");
      assert.equal(deadlineActionEnabled, false, "Deadline actions must be disabled when the clock read failed");
      const unavailable = await new QueryObserver(emptyClient, solidityOptions).refetch();
      assert.equal(unavailable.isError, true);
      assert.equal(unavailable.data, undefined, "An initial Solidity clock failure is unavailable");
      assert.equal(calls.chain, chainCalls, "Neither Solidity failure falls back to the RPC clock");
      assert.ok(calls.solidity >= 3);
    } finally {
      client.clear();
      emptyClient.clear();
    }
  });
}

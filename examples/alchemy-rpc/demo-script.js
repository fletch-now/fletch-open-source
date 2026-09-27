import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

// Resolve beside the script so running it from the repository root also works.
dotenv.config({ path: fileURLToPath(new URL(".env", import.meta.url)), quiet: true });

const apiKey = process.env.ALCHEMY_API_KEY?.trim();
let requestId = 0;

async function rpc(method, params = []) {
  const id = ++requestId;
  let response;
  try {
    response = await fetch(
      `https://robinhood-mainnet.g.alchemy.com/v2/${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    // Transport errors can include the credential-bearing URL.
    throw new Error(`${method}: network request failed or timed out.`);
  }

  if (!response.ok) {
    throw new Error(`${method}: HTTP ${response.status}. Check key, network access and Alchemy quota.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${method}: the provider returned invalid JSON.`);
  }
  if (payload?.jsonrpc !== "2.0" || payload.id !== id) {
    throw new Error(`${method}: invalid JSON-RPC response.`);
  }
  if (payload.error) {
    const code = Number.isInteger(payload.error.code) ? payload.error.code : "unknown";
    throw new Error(`${method}: JSON-RPC error ${code}. Check the method and Alchemy dashboard.`);
  }
  if (!("result" in payload)) {
    throw new Error(`${method}: response has no result.`);
  }
  return payload.result;
}

async function main() {
  if (!apiKey || apiKey === "<my-key>") {
    throw new Error("Create examples/alchemy-rpc/.env with ALCHEMY_API_KEY=<my-key>, replacing the placeholder with your key.");
  }

  const chainIdHex = await rpc("eth_chainId");
  const chainId = BigInt(chainIdHex);
  if (chainId !== 4663n) {
    throw new Error(`Expected Robinhood Chain Mainnet (4663), received ${chainId}.`);
  }

  const blockNumberHex = await rpc("eth_blockNumber");
  // Pin the next read to this height; "latest" could advance between calls.
  const block = await rpc("eth_getBlockByNumber", [blockNumberHex, false]);
  if (!block) {
    throw new Error("The sampled block is no longer available. Run again to sample the current head.");
  }

  console.log(JSON.stringify({
    network: "Robinhood Chain Mainnet",
    chainId: chainId.toString(),
    chainIdHex,
    blockNumber: BigInt(block.number).toString(),
    blockNumberHex: block.number,
    blockHash: block.hash,
    blockTime: new Date(Number(BigInt(block.timestamp)) * 1_000).toISOString(),
    transactionCount: block.transactions.length,
  }, null, 2));
}

main().catch(function report(error) {
  const message = error instanceof Error ? error.message : "Unexpected failure.";
  console.error(apiKey ? message.replaceAll(apiKey, "[redacted]") : message);
  process.exitCode = 1;
});

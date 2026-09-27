import { z } from "zod";

// Public, no key, 60 req/s cap (docs.robinhood.com/chain/stock-token-apis). Shaped
// from the real response — fetched and inspected directly — not from any spec.
export const ROBINHOOD_ASSETS_ENDPOINT = "https://api.robinhood.com/rhj/assets";

const FETCH_TIMEOUT_MS = 10_000;

// Every stock token deploys to one chain today, but the field is an array in the
// real payload, so a future multi-chain listing does not need a shape change here.
const deploymentSchema = z.object({
  contractAddress: z.string(),
  chainId: z.number(),
  networkName: z.string().optional(),
});

// `.passthrough()` and defensive defaults: the endpoint is not versioned and not
// ours, so an unrecognized or missing field should degrade, not throw.
const assetSchema = z
  .object({
    id: z.string(),
    tokenSymbol: z.string(),
    tokenName: z.string(),
    deployments: z.array(deploymentSchema).default([]),
    status: z.string().default("unknown"),
    tokenDecimals: z.number().default(18),
    currentMultiplier: z.string().optional(),
    pendingMultiplier: z.string().optional(),
    logoUrl: z.string().optional(),
    isin: z.string().optional(),
  })
  .passthrough();

const responseSchema = z.object({
  assets: z.array(assetSchema),
});

export type RobinhoodAssetDeployment = z.infer<typeof deploymentSchema>;
export type RobinhoodAsset = z.infer<typeof assetSchema>;

async function fetchOnce(): Promise<RobinhoodAsset[]> {
  const res = await fetch(ROBINHOOD_ASSETS_ENDPOINT, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`registry fetch failed: ${res.status} ${res.statusText}`);
  }
  const json: unknown = await res.json();
  return responseSchema.parse(json).assets;
}

// One retry beyond the first attempt — the endpoint has no documented SLA, and a
// sync run happens on a timer, so it is cheaper to retry once here than to wait for
// the next scheduled tick on a single dropped connection.
export async function fetchRobinhoodAssets(): Promise<RobinhoodAsset[]> {
  try {
    return await fetchOnce();
  } catch {
    return fetchOnce();
  }
}

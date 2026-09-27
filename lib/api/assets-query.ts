import { parseAssetSortQuery } from "@/lib/registry/asset-sort";

export function assetsQuery(params: URLSearchParams): {
  filters: Record<string, string>;
  browse: boolean;
  page?: { limit: number; offset: number };
} {
  const browseKeys = ["type", "verified", "state", "sort", "order", "limit", "offset"];
  for (const key of params.keys()) {
    if (!["q", "symbols", "fields", "trust", ...browseKeys].includes(key) || params.getAll(key).length !== 1) {
      throw new Error(`Unknown or repeated query parameter: ${key}`);
    }
  }
  const sorting = parseAssetSortQuery(params);
  if ("error" in sorting) throw new Error(sorting.error);
  const type = params.get("type") ?? "all";
  if (!["all", "stock_token", "stablecoin", "wrapped_native", "bridged"].includes(type)) throw new Error("Unknown asset type");
  const state = params.get("state") ?? "all";
  if (!["all", "feed", "stale", "paused", "halted", "pending", "residual", "divergent", "lookalikes"].includes(state)) throw new Error("Unknown asset state");
  const verified = params.get("verified") ?? "0";
  if (!["0", "1"].includes(verified)) throw new Error("verified must be 0 or 1");
  const paginated = params.has("limit") || params.has("offset");
  const limit = params.get("limit") ?? "50";
  const offset = params.get("offset") ?? "0";
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 50) throw new Error("limit must be an integer from 1 to 50");
  if (!/^\d+$/.test(offset) || Number(offset) > 1_000_000) throw new Error("offset must be an integer from 0 to 1000000");
  return {
    filters: { q: params.get("q") ?? "", type, state, verified, ...sorting },
    browse: browseKeys.some((key) => params.has(key)),
    ...(paginated ? { page: { limit: Number(limit), offset: Number(offset) } } : {}),
  };
}

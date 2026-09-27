import { parseLimit, parseOffset } from "./params";

export const LOOKALIKE_KINDS = ["impostor", "same_ticker", "unverified", "unlisted_stock"] as const;
export interface LookalikeQuery { symbol?: string; kind?: "impostor" | "same_ticker" | "unverified"; limit: number; offset: number }

export function lookalikeQuery(params: URLSearchParams): LookalikeQuery {
  for (const key of params.keys()) {
    if (!["symbol", "kind", "limit", "offset"].includes(key) || params.getAll(key).length !== 1) throw new Error(`Unknown or repeated query parameter: ${key}`);
  }
  const symbol = params.get("symbol")?.trim().replace(/^\$/, "").toUpperCase() || undefined;
  if (symbol && symbol.length > 64) throw new Error("symbol must be at most 64 characters");
  let kind = params.get("kind") || undefined;
  if (kind === "unlisted_stock") kind = "unverified";
  if (kind && kind !== "impostor" && kind !== "same_ticker" && kind !== "unverified") throw new Error("kind must be impostor, same_ticker or unverified");
  return { symbol, kind: kind as LookalikeQuery["kind"], limit: parseLimit(params.get("limit"), 300, 1000), offset: Math.min(parseOffset(params.get("offset")), 1_000_000) };
}

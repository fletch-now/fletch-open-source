import type { TokenMetadataObservation } from "./priority-metadata";
import type { Metric, MetricObservation, MetricInput, PoolQuoteObservation } from "./token-markets-types";
import { marketCapUsd } from "./authority/depth";

export const SUPPLY_FRESH_MS = 5 * 60_000;
export const METADATA_FRESH_MS = 24 * 60 * 60_000;
export const SELECTION_FRESH_MS = 15 * 60_000;
export const SELECTION_POLICY = "listed_identity_then_v3_quote_holdings_10000_else_v4_one_percent_100_v1";

export function validTime(at: string | null | undefined): string | null {
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  return new Date(at).toISOString();
}

export function expiresAt(at: string | null, maxAge: number): string | null {
  const valid = validTime(at);
  return valid ? new Date(Date.parse(valid) + maxAge).toISOString() : null;
}

export function observationStatus(at: string | null, expiration: string | null, now: number): MetricObservation["status"] {
  if (!at) return "missing";
  const time = Date.parse(at);
  const expires = expiration ? Date.parse(expiration) : NaN;
  if (!Number.isFinite(time) || time > now || !Number.isFinite(expires)) return "invalid";
  return now <= expires ? "current" : "stale";
}

export function observedMetric<T>(value: T | null, source: string | null, asOf: string | null, reason: string | null,
  facts: Partial<MetricObservation> & { maxAgeMs?: number } = {}, now = Date.now()): Metric<T> {
  const sourceAt = facts.sourceAt === undefined ? validTime(asOf) : facts.sourceAt;
  const expiry = facts.expiresAt === undefined ? expiresAt(asOf, facts.maxAgeMs ?? METADATA_FRESH_MS) : facts.expiresAt;
  const status = facts.status ?? observationStatus(asOf, expiry, now);
  let readStatus = facts.readStatus;
  if (!readStatus) {
    if (!asOf) readStatus = "unread";
    else if (value === null) readStatus = "failed";
    else readStatus = "ok";
  }
  return { value: status === "current" ? value : null, source, asOf, reason,
    observation: { sourceId: facts.sourceId ?? null, blockNumber: facts.blockNumber ?? null, blockHash: facts.blockHash ?? null,
      sourceAt, fetchedAt: facts.fetchedAt ?? null, expiresAt: expiry, method: facts.method ?? "unknown", parameters: facts.parameters ?? {},
      inputs: facts.inputs ?? [], coverage: facts.coverage ?? { status: "unknown", scope: "token", windowStartAt: null, windowEndAt: null },
      status, readStatus } };
}

export function capitalizationMetric(decimals: Metric<number>, supply: Metric<string>, burn: Metric<string>, price: Metric<number>, now: number): Metric<number> {
  const inputs: MetricInput[] = [
    { name: "decimals", ...decimals }, { name: "totalSupplyRaw", ...supply },
    { name: "burnedRaw", ...burn }, { name: "priceUsd", ...price },
  ];
  const times = inputs.map((input) => validTime(input.asOf));
  const expiries = inputs.map((input) => input.observation.expiresAt);
  // The oldest input is the compound observation's compatibility time, never just the newest price.
  const at = times.every((time) => time !== null) ? times.sort()[0] : null;
  const expiry = expiries.every((time) => time !== null) ? expiries.sort()[0] : null;
  let value: number | null = null;
  if (decimals.value !== null && supply.value !== null && burn.value !== null && price.value !== null) {
    value = marketCapUsd({ decimals: decimals.value, totalSupplyRaw: supply.value, burnedRaw: burn.value }, price.value);
  }
  const source = "Outstanding ERC-20 supply minus zero/dead-address balances, priced from the selected pool; circulating supply is not established";
  return observedMetric(value, price.source ? `${source}. ${price.source}` : source,
    at, value === null ? "Current supply, burn balances, decimals and selected-pool price are required, with burns no greater than supply." : null,
    { sourceId: "fletch:derived", sourceAt: at, expiresAt: expiry, method: "(totalSupplyRaw-burnedRaw)/10^decimals*priceUsd", inputs,
      readStatus: value !== null && inputs.every((input) => input.observation.readStatus === "ok") ? "ok" : "partial",
      coverage: { status: inputs.every((input) => input.observation.coverage.status === "complete") ? "complete" : "partial",
        scope: "token_outstanding_supply", windowStartAt: null, windowEndAt: null } }, now);
}

export function tokenSupplyMetric(metadata: TokenMetadataObservation | null, kind: "supply" | "burn", chainId: number, address: string, now: number): Metric<string> {
  const input = metadata?.[kind];
  const legacyValue = kind === "supply" ? metadata?.totalSupplyRaw : metadata?.burnedRaw;
  const value = input ? input.value : legacyValue ?? null;
  const inputAt = input?.asOf ?? metadata?.asOf ?? null;
  const error = kind === "supply" ? metadata?.supplyError : metadata?.burnError;
  const status = observationStatus(inputAt, expiresAt(inputAt, SUPPLY_FRESH_MS), now);
  let reason = error ?? input?.reason ?? null;
  if (status !== "current") reason = "The supply or burn-balance observation is older than five minutes or has no valid snapshot time.";
  else if (value === null) reason = reason ?? "The required ERC-20 calls have not succeeded.";
  let readStatus: MetricObservation["readStatus"] = "ok";
  if (error || input?.reason) readStatus = "failed";
  else if (value === null) readStatus = "unread";
  return observedMetric(value, input?.source ?? metadata?.source ?? null, inputAt, reason, {
    sourceId: `rpc:erc20:${chainId}:${address}`, blockNumber: input?.blockNumber ?? metadata?.blockNumber ?? null,
    blockHash: input?.blockHash ?? metadata?.blockHash ?? null, fetchedAt: input?.fetchedAt ?? metadata?.fetchedAt ?? null,
    maxAgeMs: SUPPLY_FRESH_MS, method: kind === "supply" ? "erc20_totalSupply" : "erc20_balanceOf_zero_plus_dead", readStatus,
    coverage: { status: value === null ? "unknown" : "complete", scope: "token", windowStartAt: null, windowEndAt: null },
  }, now);
}

export function poolQuoteMetric(quote: PoolQuoteObservation | null | undefined, poolAt: string | null, source: string | null, now: number): Metric<number> {
  if (!quote) return observedMetric<number>(null, source, null, "This legacy quote conversion did not record structured input observations.",
    { sourceId: "fletch:stored_quote_conversion", method: "unknown" }, now);
  const asOf = quote.sourceAt ?? poolAt;
  let status = observationStatus(asOf, quote.expiresAt, now);
  if (!validTime(quote.fetchedAt) || Date.parse(quote.fetchedAt!) > now) status = "invalid";
  if (quote.method !== "fixed_notional_usdg" && !validTime(quote.sourceAt)) status = "invalid";
  return observedMetric(quote.value, quote.source, asOf, quote.reason, {
    sourceId: quote.sourceId, sourceAt: quote.sourceAt, fetchedAt: quote.fetchedAt, expiresAt: quote.expiresAt,
    blockNumber: quote.blockNumber, blockHash: quote.blockHash, method: quote.method, parameters: quote.parameters, status,
    readStatus: quote.reason ? "failed" : "ok",
    coverage: { status: quote.reason ? "partial" : "complete", scope: "quote_conversion", windowStartAt: null, windowEndAt: null },
  }, now);
}

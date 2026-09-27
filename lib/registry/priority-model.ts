import { POOL_STATE_FRESH_MS } from "./authority/dex-state-freshness";

export const PRIORITY_NAMES = ["cashcat", "pipedog", "pons", "opai", "squikies", "openai", "anth", "syrupusdg"];
export const COMMUNITY_LIMIT_PER_METHOD = 30;
export const PRIORITY_POOL_LIMIT = 600;
export const PRIORITY_STATE_FRESH_MS = POOL_STATE_FRESH_MS;

export type DepthMethod = "v3_quote_holdings" | "v4_bounded_one_percent";
export interface PriorityPool {
  id: string;
  address: string;
  method: DepthMethod;
  depthUsd: number | null;
  priceUsd: number | null;
  observedAt: string | null;
  reason: string | null;
  createdBlock: string;
  lastSwapAt: string | null;
}
export interface PriorityCandidate {
  address: string;
  assetId: string | null;
  symbol: string | null;
  name: string | null;
  holders: number | null;
  pools: PriorityPool[];
}
export interface PriorityToken {
  chainId: number;
  address: string;
  assetId: string | null;
  role: "listed" | "community" | "alternative";
  groupKey: string;
  dominantAddress: string | null;
  selectionReason: string;
  closeCall: boolean;
  rank: number;
  selectedAt: string;
}

export function normalizedTokenName(value: string | null): string {
  return (value ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function currentPool(pool: PriorityPool, now = Date.now()): boolean {
  const age = pool.observedAt === null ? NaN : now - Date.parse(pool.observedAt);
  return pool.reason === null && Number.isFinite(age) && age >= 0 && age <= PRIORITY_STATE_FRESH_MS;
}

export function strongestPool(token: PriorityCandidate, method: DepthMethod, now: number): PriorityPool | null {
  return token.pools.filter((pool) => pool.method === method && currentPool(pool, now) && pool.depthUsd !== null && pool.depthUsd >= 0)
    .sort((a, b) => b.depthUsd! - a.depthUsd! || Number(BigInt(a.createdBlock) - BigInt(b.createdBlock)) || a.id.localeCompare(b.id))[0] ?? null;
}

function compareTokens(a: PriorityCandidate, b: PriorityCandidate, method: DepthMethod, now: number): number {
  const left = strongestPool(a, method, now);
  const right = strongestPool(b, method, now);
  const difference = (right?.depthUsd ?? -1) - (left?.depthUsd ?? -1);
  if (difference) return difference;
  const holders = (b.holders ?? -1) - (a.holders ?? -1);
  if (holders) return holders;
  const activity = Date.parse(right?.lastSwapAt ?? "") - Date.parse(left?.lastSwapAt ?? "");
  if (Number.isFinite(activity) && activity) return activity;
  if (left && right) {
    const age = BigInt(left.createdBlock) - BigInt(right.createdBlock);
    if (age) return age < BigInt(0) ? -1 : 1;
  }
  return a.address.localeCompare(b.address);
}

export function tokenGroups(tokens: PriorityCandidate[]): PriorityCandidate[][] {
  const parents = tokens.map((_, index) => index);
  function root(index: number): number {
    while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; }
    return index;
  }
  const keys = new Map<string, number>();
  tokens.forEach(function join(token, index) {
    for (const key of [normalizedTokenName(token.symbol), normalizedTokenName(token.name)]) {
      if (!key) continue;
      const existing = keys.get(key);
      if (existing !== undefined) parents[root(index)] = root(existing);
      else keys.set(key, index);
    }
  });
  const groups = new Map<number, PriorityCandidate[]>();
  tokens.forEach(function collect(token, index) {
    const key = root(index);
    const group = groups.get(key) ?? [];
    group.push(token); groups.set(key, group);
  });
  return [...groups.values()];
}

export function selectPriority(chainId: number, tokens: PriorityCandidate[], now = new Date(), catalogNames: string[] = []): PriorityToken[] {
  const time = now.getTime();
  const groups = tokenGroups(tokens);
  const named = new Set([...PRIORITY_NAMES, ...catalogNames.map(normalizedTokenName)]);
  const selected = new Set<PriorityCandidate[]>();
  for (const group of groups) {
    if (group.some((token) => token.assetId || named.has(normalizedTokenName(token.symbol)) || named.has(normalizedTokenName(token.name)))) selected.add(group);
  }
  for (const method of ["v3_quote_holdings", "v4_bounded_one_percent"] as const) {
    const ranked = groups.map((group) => ({ group, best: [...group].sort((a, b) => compareTokens(a, b, method, time))[0] }))
      .filter(({ best }) => !best.assetId && (strongestPool(best, method, time)?.depthUsd ?? 0) >= (method === "v3_quote_holdings" ? 10_000 : 100))
      .sort((a, b) => compareTokens(a.best, b.best, method, time)).slice(0, COMMUNITY_LIMIT_PER_METHOD);
    for (const { group } of ranked) selected.add(group);
  }
  const output: PriorityToken[] = [];
  let rank = 0;
  for (const group of [...selected].sort((a, b) => a[0].address.localeCompare(b[0].address))) {
    const listed = group.filter((token) => token.assetId).sort((a, b) => a.address.localeCompare(b.address));
    const v3 = [...group].sort((a, b) => compareTokens(a, b, "v3_quote_holdings", time));
    const v4 = [...group].sort((a, b) => compareTokens(a, b, "v4_bounded_one_percent", time));
    const hasV3 = (strongestPool(v3[0], "v3_quote_holdings", time)?.depthUsd ?? 0) >= 10_000;
    const method: DepthMethod = hasV3 ? "v3_quote_holdings" : "v4_bounded_one_percent";
    const ranked = hasV3 ? v3 : v4;
    const winner = listed[0] ?? ranked[0];
    const best = strongestPool(winner, method, time);
    const runnerUp = ranked.find((token) => token.address !== winner.address);
    const second = runnerUp ? strongestPool(runnerUp, method, time) : null;
    const closeCall = !listed.length && best?.depthUsd !== null && best?.depthUsd !== undefined && best.depthUsd > 0
      && second?.depthUsd !== null && second?.depthUsd !== undefined && second.depthUsd >= best.depthUsd * 0.8;
    const established = listed.length > 0 || (best?.depthUsd ?? 0) >= (method === "v3_quote_holdings" ? 10_000 : 100);
    let reason = "No fresh qualifying liquidity observation establishes a dominant contract in this tracked group.";
    if (listed.length) reason = "This address is on Robinhood's published list. Same-name contracts remain separate identities.";
    else if (established && method === "v3_quote_holdings") reason = "Largest measured quote holding in a single tracked V3 pool, among same-name contracts. V3 holdings above $10,000 take selection priority; V4 impact estimates are shown separately and are not compared or added.";
    else if (established) reason = "Largest bounded 1% depth estimate in a single tracked V4 pool, among same-name contracts. No tracked V3 candidate has $10,000 of measured quote holdings.";
    if (closeCall) reason += " Another contract is within 20% by the same measure.";
    const groupKey = group.map((token) => token.address).sort()[0];
    for (const token of group) {
      output.push({ chainId, address: token.address, assetId: token.assetId,
        role: token.assetId ? "listed" : token === winner ? "community" : "alternative", groupKey,
        dominantAddress: token.assetId ? token.address : established ? winner.address : null,
        selectionReason: listed.length && !token.assetId ? "A different address in this same-name group is on Robinhood's published list; the listing applies only to that address." : reason,
        closeCall, rank: rank++, selectedAt: now.toISOString() });
    }
  }
  return output;
}

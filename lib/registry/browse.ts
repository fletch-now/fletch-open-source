import { registryTokenFacts, trustVerdict, type TrustVerdict } from "@/lib/registry/trust-rules";
export type { TrustLevel } from "@/lib/registry/trust-rules";
import { publicReadCache } from "@/lib/public-cache";
import { and, asc, desc, eq, getTableColumns, gt, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { assetSearchCondition } from "@/lib/registry/search";
import { defaultAssetSortOrder, isAssetSort, type AssetSort, type AssetSortOrder } from "@/lib/registry/asset-sort";
export { defaultAssetSortOrder, SORT_LABEL, type AssetSort, type AssetSortOrder } from "@/lib/registry/asset-sort";
import { registryAssetState, registryAssets, watcherDeliveries, watchers } from "@/lib/db/schema";
import { getChainClient } from "@/lib/chain/rpc";
import { fetchTransferLogs, decodeAmount, type TransferLog } from "@/lib/chain/logs";
import { logEvent } from "@/lib/log";
import type { RegistryAsset } from "@/lib/registry/assets";
import { LATEST_FLOAT_PCT, LATEST_UNKNOWN_PCT } from "@/lib/registry/authority/read";

// Read paths for the public token pages: a filterable list, and the live
// on-chain facts one token page shows. No "server-only" so the same functions
// serve route handlers and pages alike.

export type AssetTypeFilter = "all" | "stock_token" | "stablecoin" | "wrapped_native" | "bridged";
// Filters on what the authority daemon knows, not on the listing: the things
// a reader cannot get from Robinhood's list or from Blockscout.
export type StateFilter = "all" | "feed" | "stale" | "paused" | "halted" | "pending" | "residual" | "divergent" | "lookalikes";

export interface BrowseFilters {
  q: string;
  type: AssetTypeFilter;
  verifiedOnly: boolean;
  state: StateFilter;
  sort: AssetSort;
  order: AssetSortOrder;
}

export const STATE_FILTER_LABEL: Record<Exclude<StateFilter, "all">, string> = {
  feed: "Price feed",
  stale: "Feed stale",
  paused: "Paused",
  halted: "Trading halted",
  pending: "Split pending",
  residual: "Supply residual",
  divergent: "Price diverges",
  lookalikes: "Has lookalikes",
};

export type BrowseRow = RegistryAsset & { lookalikeCount: number; floatPct: string | null; unknownPct: string | null };

export const ASSET_TYPE_LABEL: Record<Exclude<AssetTypeFilter, "all">, string> = {
  stock_token: "Stock Token",
  stablecoin: "Stablecoin",
  wrapped_native: "Wrapped native",
  bridged: "Bridged",
};

export function parseFilters(params: Record<string, string | string[] | undefined>): BrowseFilters {
  const q = typeof params.q === "string" ? params.q.slice(0, 64) : "";
  const rawType = typeof params.type === "string" ? params.type : "all";
  const type: AssetTypeFilter = Object.hasOwn(ASSET_TYPE_LABEL, rawType) ? (rawType as AssetTypeFilter) : "all";
  const rawSort = typeof params.sort === "string" ? params.sort : "symbol";
  const sort: AssetSort = isAssetSort(rawSort) ? (rawSort as AssetSort) : "symbol";
  const rawState = typeof params.state === "string" ? params.state : "all";
  const state: StateFilter = Object.hasOwn(STATE_FILTER_LABEL, rawState) ? (rawState as StateFilter) : "all";
  const order = params.order === "asc" || params.order === "desc" ? params.order : defaultAssetSortOrder(sort);
  return { q, type, verifiedOnly: params.verified === "1", state, sort, order };
}

const LOOKALIKE_COUNT = sql<number>`(select count(*) from lookalike_tokens l where l.matches_asset_id = ${registryAssets.id})`;
const LATEST_RESIDUAL = sql`exists (select 1 from registry_supply_snapshots s where s.asset_id = ${registryAssets.id} and s.day = (select max(day) from registry_supply_snapshots) and s.residual_raw <> 0)`;

// Same identity predicate as registryTokenFacts: a receipt alone is not verification.
const VERIFIED_IDENTITY = sql`case when ${registryAssets.verifiedAt} is not null
  and upper(${registryAssets.onchainSymbol}) = upper(${registryAssets.symbol})
  and ${registryAssets.onchainDecimals} = ${registryAssets.decimals} then 1 else 0 end`;
// Match the compact state label's precedence; an unread state remains unknown.
const STATE_LABEL = sql`case
  when ${registryAssetState.stateCheckedAt} is null then null
  when ${registryAssetState.stateCheckedAt} < now() - interval '15 minutes' then 'stale read'
  when ${registryAssetState.tokenPaused} is null and ${registryAssetState.canonical} is null then 'not a Stock Token'
  when ${registryAssetState.tokenPaused} then 'paused'
  when ${registryAssetState.canonical} = false then 'not canonical'
  when ${registryAssetState.feedStale} then 'feed stale'
  else 'checks current' end`;

function orderFor(sort: AssetSort, order: AssetSortOrder): SQL {
  const expressions = {
    symbol: registryAssets.symbol,
    name: registryAssets.name,
    type: registryAssets.assetType,
    address: registryAssets.address,
    newest: registryAssets.firstSeenAt,
    verified: VERIFIED_IDENTITY,
    holders: registryAssetState.blockscoutHolders,
    price: registryAssetState.feedPrice,
    lookalikes: LOOKALIKE_COUNT,
    multiplier: registryAssetState.uiMultiplier,
    float: LATEST_FLOAT_PCT,
    state: STATE_LABEL,
  };
  const expression = expressions[sort];
  return order === "desc" ? sql`${expression} desc nulls last` : sql`${expression} asc nulls last`;
}

function stateCondition(state: StateFilter): SQL | undefined {
  switch (state) {
    case "feed":
      return isNotNull(registryAssetState.feedPrice);
    case "stale":
      return eq(registryAssetState.feedStale, true);
    case "paused":
      return or(eq(registryAssetState.tokenPaused, true), eq(registryAssetState.oraclePaused, true));
    case "halted":
      return eq(registryAssetState.apiTradingHalt, true);
    case "pending":
      return gt(registryAssetState.multiplierEffectiveAt, sql`now()`);
    case "residual":
      return LATEST_RESIDUAL;
    case "divergent":
      return sql`abs(${registryAssetState.priceDivergencePct}) > 1`;
    case "lookalikes":
      return sql`${LOOKALIKE_COUNT} > 0`;
    default:
      return undefined;
  }
}

export interface BrowseSelection { symbols?: string[]; trust?: string }

function browseConditions(chainId: number, filters: BrowseFilters, selection?: BrowseSelection): SQL | undefined {
  const conditions = [
    eq(registryAssets.chainId, chainId),
    eq(registryAssets.status, "active"),
    filters.type === "all" ? undefined : eq(registryAssets.assetType, filters.type),
    filters.verifiedOnly ? and(isNotNull(registryAssets.verifiedAt),
      sql`upper(${registryAssets.onchainSymbol}) = upper(${registryAssets.symbol})`,
      eq(registryAssets.onchainDecimals, registryAssets.decimals)) : undefined,
    stateCondition(filters.state),
    assetSearchCondition(filters.q),
    selection?.symbols ? inArray(sql`upper(${registryAssets.symbol})`, selection.symbols) : undefined,
    selection?.trust ? sql`${VERIFIED_IDENTITY} = ${selection.trust === "verified" ? 1 : 0}` : undefined,
    selection?.trust && !["verified", "listed"].includes(selection.trust) ? sql`false` : undefined,
  ].filter(Boolean);
  return and(...conditions);
}

// The listing joined to the daemon's state, so a sort by holders or price and a
// filter on pauses or residuals run in the database rather than in a page.
export async function browseAssets(chainId: number, filters: BrowseFilters, page?: { limit: number; offset: number }, selection?: BrowseSelection): Promise<BrowseRow[]> {
  const query = db
    .select({ ...getTableColumns(registryAssets), lookalikeCount: LOOKALIKE_COUNT, floatPct: LATEST_FLOAT_PCT, unknownPct: LATEST_UNKNOWN_PCT })
    .from(registryAssets)
    .leftJoin(registryAssetState, eq(registryAssetState.assetId, registryAssets.id))
    .where(browseConditions(chainId, filters, selection))
    .orderBy(orderFor(filters.sort, filters.order), asc(registryAssets.address))
    .$dynamic();
  const rows = page ? await query.limit(Math.min(50, Math.max(1, page.limit))).offset(Math.max(0, page.offset)) : await query;
  return rows.map(function shape(row) {
    return { ...row, lookalikeCount: Number(row.lookalikeCount) };
  });
}

export async function browseAssetsPage(chainId: number, filters: BrowseFilters, page: { limit: number; offset: number }, selection?: BrowseSelection): Promise<{ rows: BrowseRow[]; total: number }> {
  const [rows, count] = await Promise.all([
    browseAssets(chainId, filters, page, selection),
    db.select({ total: sql<number>`count(*)` }).from(registryAssets)
      .leftJoin(registryAssetState, eq(registryAssetState.assetId, registryAssets.id))
      .where(browseConditions(chainId, filters, selection)),
  ]);
  return { rows, total: Number(count[0]?.total ?? 0) };
}

export type StateFacets = Record<Exclude<StateFilter, "all">, number>;

// How many assets each state chip would show, so a chip reads "Paused 0"
// rather than inviting a click that finds nothing.
export async function browseFacets(chainId: number): Promise<StateFacets> {
  const rows = await db
    .select({
      feed: sql<number>`count(*) filter (where ${registryAssetState.feedPrice} is not null)`,
      stale: sql<number>`count(*) filter (where ${registryAssetState.feedStale})`,
      paused: sql<number>`count(*) filter (where ${registryAssetState.tokenPaused} or ${registryAssetState.oraclePaused})`,
      halted: sql<number>`count(*) filter (where ${registryAssetState.apiTradingHalt})`,
      pending: sql<number>`count(*) filter (where ${registryAssetState.multiplierEffectiveAt} > now())`,
      residual: sql<number>`count(*) filter (where ${LATEST_RESIDUAL})`,
      divergent: sql<number>`count(*) filter (where abs(${registryAssetState.priceDivergencePct}) > 1)`,
      lookalikes: sql<number>`count(*) filter (where ${LOOKALIKE_COUNT} > 0)`,
    })
    .from(registryAssets)
    .leftJoin(registryAssetState, eq(registryAssetState.assetId, registryAssets.id))
    .where(and(eq(registryAssets.chainId, chainId), eq(registryAssets.status, "active")));
  const row = rows[0];
  return {
    feed: Number(row?.feed ?? 0),
    stale: Number(row?.stale ?? 0),
    paused: Number(row?.paused ?? 0),
    halted: Number(row?.halted ?? 0),
    pending: Number(row?.pending ?? 0),
    residual: Number(row?.residual ?? 0),
    divergent: Number(row?.divergent ?? 0),
    lookalikes: Number(row?.lookalikes ?? 0),
  };
}

export interface BrowseSummary {
  total: number;
  verified: number;
  byType: { assetType: string; count: number }[];
  lastObservedAt: Date | null;
}

export async function browseSummary(chainId: number): Promise<BrowseSummary> {
  const rows = await db
    .select({
      assetType: registryAssets.assetType,
      count: sql<string>`count(*)`,
      verified: sql<string>`count(*) filter (where ${registryAssets.verifiedAt} is not null)`,
      lastObservedAt: sql<Date | null>`max(${registryAssets.observedAt})`,
    })
    .from(registryAssets)
    .where(and(eq(registryAssets.chainId, chainId), eq(registryAssets.status, "active")))
    .groupBy(registryAssets.assetType);
  let lastObservedAt: Date | null = null;
  for (const row of rows) {
    const observed = row.lastObservedAt ? new Date(row.lastObservedAt) : null;
    if (observed && (!lastObservedAt || observed > lastObservedAt)) {
      lastObservedAt = observed;
    }
  }
  return {
    total: rows.reduce((sum, row) => sum + Number(row.count), 0),
    verified: rows.reduce((sum, row) => sum + Number(row.verified), 0),
    byType: rows.map((row) => ({ assetType: row.assetType, count: Number(row.count) })),
    lastObservedAt,
  };
}

// ── Live facts for one token ──────────────────────────────────────────────

const ERC20_ABI = [
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

// Robinhood Chain lands a block every 100 ms, so 1,500 blocks is about the last
// two and a half minutes: enough to show whether a token is moving right now,
// one eth_getLogs call per page render.
const RECENT_BLOCKS = BigInt(1500);
const RECENT_LIMIT = 8;

export interface RecentTransfer {
  txHash: string;
  logIndex: number;
  from: string;
  to: string;
  amount: string;
  blockNumber: string;
}

export interface TokenOnChain {
  headBlock: string | null;
  totalSupply: string | null;
  hasCode: boolean | null;
  recentCount: number | null;
  recent: RecentTransfer[];
  window: string;
}

function largestFirst(a: TransferLog, b: TransferLog): number {
  if (a.value === b.value) {
    return 0;
  }
  return a.value > b.value ? -1 : 1;
}

// Each call is one page render; the page is revalidated every five minutes, so a
// popular token costs a handful of RPC calls an hour. Every failure degrades to
// null rather than taking the page down: the registry facts still render.
const cachedTokenRead = publicReadCache<TokenOnChain>(15_000, 256);

export function tokenOnChain(asset: RegistryAsset): Promise<TokenOnChain> {
  return cachedTokenRead(asset.id, () => readTokenOnChain(asset));
}

async function readTokenOnChain(asset: RegistryAsset): Promise<TokenOnChain> {
  const client = getChainClient(asset.chainId);
  const address = asset.address as `0x${string}`;
  const result: TokenOnChain = { headBlock: null, totalSupply: null, hasCode: null, recentCount: null, recent: [], window: "" };
  try {
    const [head, code, supply] = await Promise.all([
      client.getBlockNumber(),
      client.getBytecode({ address }),
      client.readContract({ address, abi: ERC20_ABI, functionName: "totalSupply" }).catch(function unreadable() {
        return null;
      }),
    ]);
    result.headBlock = head.toString();
    result.hasCode = Boolean(code && code !== "0x");
    result.totalSupply = supply === null ? null : decodeAmount(supply, asset.decimals);
    const fromBlock = head > RECENT_BLOCKS ? head - RECENT_BLOCKS : BigInt(0);
    result.window = `blocks ${fromBlock.toString()} to ${head.toString()}`;
    const deadline = Date.now() + 4_000;
    const logs = await fetchTransferLogs({ daemon: false, chainId: asset.chainId, address: asset.address, fromBlock, toBlock: head,
      onRpcCall: async function withinDeadline() { return Date.now() < deadline; },
    });
    result.recentCount = logs.length;
    result.recent = [...logs]
      .sort(largestFirst)
      .slice(0, RECENT_LIMIT)
      .map(function shape(log) {
        return {
          txHash: log.txHash,
          logIndex: log.logIndex,
          from: log.from,
          to: log.to,
          amount: decodeAmount(log.value, asset.decimals),
          blockNumber: log.blockNumber.toString(),
        };
      });
  } catch (cause) {
    logEvent("registry", { event: "token-page-rpc-failed", asset: asset.id, error: String(cause) });
  }
  return result;
}

// ── Trust: what Fletch can say about a row, in order of strength ───────────

// A registry row is already resolved; use the same pure verdict as the
// arbitrary-address resolver without doing another database lookup per row.
export function assetTrust(asset: RegistryAsset): TrustVerdict {
  return trustVerdict(registryTokenFacts(asset), []);
}

// ── New listings: the record only Fletch keeps ────────────────────────────

export async function newListings(chainId: number, limit = 12): Promise<RegistryAsset[]> {
  return db
    .select()
    .from(registryAssets)
    .where(and(eq(registryAssets.chainId, chainId), eq(registryAssets.status, "active")))
    .orderBy(desc(registryAssets.firstSeenAt))
    .limit(limit);
}

// ── Activity: how much of Fletch is pointed at one asset ──────────────────

export interface AssetActivity {
  watchers: number;
  alerts: number;
}

export async function assetActivity(assetId: string): Promise<AssetActivity> {
  const [watcherRows, alertRows] = await Promise.all([
    db.select({ n: sql<string>`count(*)` }).from(watchers).where(and(eq(watchers.assetId, assetId), eq(watchers.enabled, true))),
    db
      .select({ n: sql<string>`count(*)` })
      .from(watcherDeliveries)
      .innerJoin(watchers, eq(watcherDeliveries.watcherId, watchers.id))
      .where(and(eq(watchers.assetId, assetId), eq(watcherDeliveries.status, "sent"))),
  ]);
  return { watchers: Number(watcherRows[0]?.n ?? 0), alerts: Number(alertRows[0]?.n ?? 0) };
}

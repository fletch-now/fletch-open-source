// Name and ticker collisions are independent of issuer provenance. A beacon
// slot records a contract dependency; any deployer can point a contract at it.

import { and, eq, inArray } from "drizzle-orm";
import type { PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { setImmediate } from "node:timers/promises";
import { db, pool } from "@/lib/db";
import { getMarketReadClient } from "@/lib/chain/rpc";
import { checkRpcBudget } from "@/lib/ratelimit";
import { redactSecrets } from "@/lib/redact";
import { lookalikeTokens } from "@/lib/db/schema";
import { activeAssets, type TrackedAsset } from "@/lib/registry/authority/assets";
import { BlockscoutUnavailableError, searchTokenPage, type BlockscoutToken, type ExplorerCursor, type ExplorerTokenPage } from "@/lib/registry/authority/blockscout";
import { ACCESS_CONTROLS_REGISTRY, EIP1967_BEACON_SLOT } from "@/lib/registry/authority/constants";
import { emitEvents } from "@/lib/registry/authority/events";
import { type RunOutcome } from "@/lib/registry/authority/runs";
import { verifiedAssetIndex, type VerifiedAsset } from "@/lib/registry/trust";
import { foldTicker } from "@/lib/registry/trust-rules";

const SCANNED_TYPES = ["stock_token", "bridged"];
// A lookalike nobody holds is recorded but not announced; below this many
// holders it is noise in a Telegram feed.
const EVENT_HOLDERS_FLOOR = 50;
export const LOOKALIKE_SEARCH_BATCH = 8;
export const LOOKALIKE_LOCAL_BATCH = 1_000;
export const LOOKALIKE_BEACON_BATCH = 8;
const BEACON_RETRY_SLOTS = 2;
const WORK_MS = 40_000;

interface Dependencies {
  search?: (symbol: string, cursor: ExplorerCursor | null) => Promise<ExplorerTokenPage>;
  beacon?: (chainId: number, address: string) => Promise<string | null>;
}

interface Candidate {
  asset: TrackedAsset;
  token: BlockscoutToken;
  exactName: boolean;
}

function claims(candidate: Pick<BlockscoutToken, "symbol" | "name">, asset: Pick<TrackedAsset, "symbol" | "name">): { symbol: boolean; name: boolean; exactName: boolean } {
  return {
    // Folded, not merely upper-cased: a Cyrillic Т and a Latin T are one glyph
    // on screen, and a ticker that reads as TSLA claims TSLA whatever code
    // points it is made of.
    symbol: foldTicker(candidate.symbol) !== "" && foldTicker(candidate.symbol) === foldTicker(asset.symbol),
    name: foldTicker(candidate.name) !== "" && foldTicker(candidate.name) === foldTicker(asset.name),
    exactName: Boolean(candidate.name?.trim()) && candidate.name?.trim().toLowerCase() === asset.name.trim().toLowerCase(),
  };
}

// Local metadata can establish a collision without either explorer or RPC
// access. Existing observations keep their original ages and enrichment.
export async function recordFoldedLookalike(chainId: number, token: BlockscoutToken, asset: TrackedAsset, now: Date): Promise<boolean> {
  const written = await db.insert(lookalikeTokens).values({
    id: `${chainId}:${token.address}`,
    chainId,
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    holders: token.holders,
    totalSupplyRaw: token.totalSupplyRaw,
    matchesAssetId: asset.id,
    matchesSymbol: asset.symbol,
    kind: "unverified",
    exactName: claims(token, asset).exactName,
    firstSeenAt: now,
    lastSeenAt: now,
  }).onConflictDoNothing().returning({ id: lookalikeTokens.id });
  return written.length > 0;
}

// Keep the first listing in each folded bucket. When a symbol and a name
// point to different listings, preserve the original scan's first-match order.
export function localCollisionMatcher(verified: readonly VerifiedAsset[]): (token: Pick<BlockscoutToken, "symbol" | "name">) => VerifiedAsset | null {
  const symbols = new Map<string, number>();
  const names = new Map<string, number>();
  for (const [index, asset] of verified.entries()) {
    const symbol = foldTicker(asset.symbol);
    const name = foldTicker(asset.name);
    if (symbol && !symbols.has(symbol)) symbols.set(symbol, index);
    if (name && !names.has(name)) names.set(name, index);
  }
  return function match(token): VerifiedAsset | null {
    const symbol = symbols.get(foldTicker(token.symbol));
    const name = names.get(foldTicker(token.name));
    const index = Math.min(symbol ?? Infinity, name ?? Infinity);
    return verified[index] ?? null;
  };
}

interface LocalToken extends BlockscoutToken { checkedAt: Date }

async function recordLocalCollisions(chainId: number, owner: PoolClient): Promise<{ candidates: number; added: number; complete: boolean; scanned: number }> {
  const verified = await verifiedAssetIndex(chainId);
  const progress = await owner.query<{ after_address: string }>(
    "select after_address from registry_lookalike_local_scan where chain_id=$1", [chainId]);
  const rows = await owner.query<LocalToken>(`select address,symbol,name,decimals,total_supply_raw::text "totalSupplyRaw",checked_at at time zone 'UTC' "checkedAt",null::integer holders
    from dex_tokens where chain_id=$1 and checked_at is not null and address>$2
    order by address limit $3`, [chainId, progress.rows[0]?.after_address ?? "", LOOKALIKE_LOCAL_BATCH + 1]);
  const tokens = rows.rows.slice(0, LOOKALIKE_LOCAL_BATCH);
  const recorded = tokens.length ? await db.select({ address: lookalikeTokens.address }).from(lookalikeTokens)
    .where(and(eq(lookalikeTokens.chainId, chainId), inArray(lookalikeTokens.address, tokens.map((token) => token.address)))) : [];
  const listed = new Set(verified.map((asset) => asset.address.toLowerCase()));
  const existing = new Set(recorded.map((row) => row.address.toLowerCase()));
  const match = localCollisionMatcher(verified);
  let candidates = 0;
  let added = 0;
  for (const [index, token] of tokens.entries()) {
    if (index > 0 && index % 256 === 0) await setImmediate();
    const address = token.address.toLowerCase();
    if (listed.has(address)) continue;
    const asset = match(token);
    if (!asset) continue;
    candidates += 1;
    if (existing.has(address)) continue;
    if (await recordFoldedLookalike(chainId, { ...token, address }, {
      ...asset, chainId, address: asset.address as `0x${string}`,
    }, token.checkedAt)) added += 1;
    existing.add(address);
  }
  const complete = rows.rows.length <= LOOKALIKE_LOCAL_BATCH;
  await owner.query(`insert into registry_lookalike_local_scan(chain_id,after_address,completed_at)
    values($1,$2,case when $3 then now() else null end)
    on conflict(chain_id) do update set after_address=excluded.after_address,
    completed_at=case when $3 then now() else registry_lookalike_local_scan.completed_at end`,
  [chainId, complete ? "" : tokens[tokens.length - 1].address, complete]);
  return { candidates, added, complete, scanned: tokens.length };
}

function addressFromSlot(slot: `0x${string}` | undefined): string | null {
  if (!slot || slot.length < 42) return null;
  const address = `0x${slot.slice(-40)}`.toLowerCase();
  return address === "0x0000000000000000000000000000000000000000" ? null : address;
}

// These legacy kind names describe naming evidence, not fraudulent intent.
function claimsToBeListed(candidate: Candidate): boolean {
  return candidate.exactName || /robinhood/i.test(candidate.token.name ?? "");
}

function kindOf(candidate: Candidate, beacon: string | null): string {
  if (beacon === ACCESS_CONTROLS_REGISTRY.toLowerCase()) {
    return "unverified";
  }
  if (candidate.asset.assetType === "bridged") {
    return "unverified";
  }
  return claimsToBeListed(candidate) ? "impostor" : "same_ticker";
}

async function upsert(chainId: number, candidate: Candidate, beacon: string | null, now: Date, owner: PoolClient): Promise<boolean> {
  const { asset, token, exactName } = candidate;
  const written = await owner.query<{ inserted: boolean }>(`insert into lookalike_tokens
    (id,chain_id,address,symbol,name,decimals,holders,total_supply_raw,matches_asset_id,matches_symbol,kind,exact_name,beacon,last_seen_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    on conflict(id) do update set symbol=excluded.symbol,name=excluded.name,decimals=excluded.decimals,
    holders=excluded.holders,total_supply_raw=excluded.total_supply_raw,kind=excluded.kind,
    exact_name=excluded.exact_name,last_seen_at=excluded.last_seen_at returning (xmax=0) inserted`,
  [`${chainId}:${token.address}`, chainId, token.address, token.symbol, token.name, token.decimals,
    token.holders, token.totalSupplyRaw, asset.id, asset.symbol, kindOf(candidate, beacon), exactName, beacon, now.toISOString()]);
  return written.rows[0]?.inserted === true;
}

async function announce(chainId: number, candidate: Candidate, beacon: string | null, now: Date, owner: PoolClient): Promise<void> {
  const { asset, token, exactName } = candidate;
  await emitEvents([
    {
      chainId,
      kind: "lookalike.found",
      assetId: asset.id,
      address: token.address,
      symbol: asset.symbol,
      key: token.address,
      detail: {
        name: token.name,
        symbol: token.symbol,
        holders: token.holders,
        exactName,
        lookalikeKind: kindOf(candidate, beacon),
      },
      occurredAt: now,
    },
  ], drizzle(owner));
}

interface SearchProgress {
  asset_id: string;
  next_page: ExplorerCursor | null;
  completed_at: Date | null;
}

async function dueSearches(chainId: number, owner: PoolClient): Promise<SearchProgress[]> {
  // Renamed listings begin a new search; ordinary catalog observation ticks do
  // not discard a committed cursor.
  await owner.query(`insert into registry_lookalike_searches(chain_id,asset_id,symbol)
    select chain_id,id,symbol from registry_assets where chain_id=$1 and status='active' and asset_type=any($2::text[])
    on conflict(chain_id,asset_id) do update set symbol=excluded.symbol,attempted_at=null,
    observed_at=null,completed_at=null,next_page=null,error=null
    where registry_lookalike_searches.symbol is distinct from excluded.symbol`, [chainId, SCANNED_TYPES]);
  // Reserve one slot for an overdue failure; the other slots prefer fresh
  // searches and continuations. Neither a large first pass nor repeated
  // endpoint failures can monopolize the bounded batch.
  const rows = await owner.query<SearchProgress>(`with due as (
    select s.asset_id,s.next_page,s.completed_at,s.attempted_at,s.error
    from registry_lookalike_searches s join registry_assets a on a.id=s.asset_id and a.chain_id=s.chain_id
    where s.chain_id=$1 and a.status='active' and a.asset_type=any($2::text[])
      and (s.completed_at is null or s.next_page is not null or s.completed_at<now()-interval '6 hours')
      and (s.error is null or s.attempted_at<now()-interval '5 minutes')
    ) select asset_id,next_page,completed_at from due
    order by (asset_id in (select asset_id from due where error is not null order by attempted_at,asset_id limit 1)) desc,
      (error is not null),attempted_at asc nulls first,asset_id limit $3`, [chainId, SCANNED_TYPES, LOOKALIKE_SEARCH_BATCH]);
  return rows.rows;
}

async function savePage(chainId: number, asset: TrackedAsset, progress: SearchProgress, page: ExplorerTokenPage,
  canonical: Set<string>, owner: PoolClient): Promise<{ candidates: number; added: number; announced: number }> {
  const now = new Date();
  let announced = 0;
  let candidates = 0;
  let added = 0;
  await owner.query("begin");
  try {
    for (const token of page.items) {
      const claim = claims(token, asset);
      if (canonical.has(token.address) || (!claim.symbol && !claim.name)) continue;
      candidates++;
      const candidate = { asset, token, exactName: claim.exactName };
      const existing = await owner.query<{ beacon: string | null }>("select beacon from lookalike_tokens where chain_id=$1 and address=$2", [chainId, token.address]);
      const beacon = existing.rows[0]?.beacon ?? null;
      if (await upsert(chainId, candidate, beacon, now, owner)) {
        added++;
        if (progress.completed_at && (token.holders ?? 0) >= EVENT_HOLDERS_FLOOR) {
          await announce(chainId, candidate, beacon, now, owner);
          announced++;
        }
      }
    }
    await owner.query(`update registry_lookalike_searches set observed_at=$3,next_page=$4,
      completed_at=case when $4::jsonb is null then $3 else completed_at end,error=null where chain_id=$1 and asset_id=$2`,
    [chainId, asset.id, now, page.next]);
    await owner.query("commit");
  } catch (error) {
    await owner.query("rollback");
    throw error;
  }
  return { candidates, added, announced };
}

async function enrichBeacons(chainId: number, owner: PoolClient, dependencies: Dependencies): Promise<{ read: number; failed: number; retried: number }> {
  // An unread backlog can take days to drain. Reserve retry slots so a brief
  // budget outage does not strand failures behind every never-read address.
  const rows = await owner.query<{ address: string; retry: boolean }>(`with due as (
    select l.address,l.first_seen_at,b.attempted_at,b.error from lookalike_tokens l
    left join registry_lookalike_beacons b on b.chain_id=l.chain_id and b.address=l.address
    where l.chain_id=$1 and l.beacon is null and b.checked_at is null
      and (b.attempted_at is null or b.attempted_at<now()-interval '15 minutes')
    ) select address,error is not null retry from due
    order by (address in (select address from due where error is not null order by attempted_at,address limit $3)) desc,
      (error is not null),attempted_at asc nulls first,first_seen_at,address limit $2`,
  [chainId, LOOKALIKE_BEACON_BATCH, BEACON_RETRY_SLOTS]);
  if (!rows.rows.length) return { read: 0, failed: 0, retried: 0 };
  const client = dependencies.beacon ? null : getMarketReadClient(chainId, checkRpcBudget);
  let failed = 0;
  // A successful null slot has its own receipt, so it is never mistaken for an
  // unread address. Failed reads retain the old observation and retry fairly.
  await owner.query(`insert into registry_lookalike_beacons(chain_id,address,attempted_at)
    select $1,unnest($2::text[]),now() on conflict(chain_id,address) do update set attempted_at=now()`,
  [chainId, rows.rows.map((row) => row.address)]);
  const observations = await Promise.allSettled(rows.rows.map(async function read(row): Promise<string | null> {
    if (dependencies.beacon) return dependencies.beacon(chainId, row.address);
    return addressFromSlot(await client!.getStorageAt({ address: row.address as `0x${string}`, slot: EIP1967_BEACON_SLOT }));
  }));
  for (const [index, observation] of observations.entries()) {
    const row = rows.rows[index];
    if (observation.status === "fulfilled") {
      await owner.query(`update lookalike_tokens set beacon=$3,
        kind=case when $3=$4 then 'unverified' else kind end where chain_id=$1 and address=$2`,
      [chainId, row.address, observation.value, ACCESS_CONTROLS_REGISTRY.toLowerCase()]);
      await owner.query("update registry_lookalike_beacons set checked_at=now(),error=null where chain_id=$1 and address=$2", [chainId, row.address]);
    } else {
      failed++;
      await owner.query("update registry_lookalike_beacons set error=$3 where chain_id=$1 and address=$2", [chainId, row.address, errorMessage(observation.reason)]);
    }
  }
  return { read: rows.rows.length, failed, retried: rows.rows.filter((row) => row.retry).length };
}

export interface LookalikeCoverage {
  assets: number;
  completed: number;
  pending: number;
  failed: number;
  oldestCompletedAt: string | null;
  lastObservedAt: string | null;
  localCompletedAt: string | null;
  beaconPending: number;
  beaconFailed: number;
}

export async function getLookalikeCoverage(chainId: number): Promise<LookalikeCoverage> {
  const result = await pool.query<LookalikeCoverage>(`select count(*)::integer assets,
    count(*) filter(where s.completed_at>=now()-interval '6 hours' and s.next_page is null)::integer completed,
    count(*) filter(where s.completed_at is null or s.completed_at<now()-interval '6 hours' or s.next_page is not null)::integer pending,
    count(*) filter(where s.error is not null)::integer failed,
    min(s.completed_at)::text "oldestCompletedAt",max(s.observed_at)::text "lastObservedAt",
    (select completed_at::text from registry_lookalike_local_scan where chain_id=$1) "localCompletedAt",
    (select count(*)::integer from lookalike_tokens l left join registry_lookalike_beacons b on b.chain_id=l.chain_id and b.address=l.address
      where l.chain_id=$1 and l.beacon is null and b.checked_at is null) "beaconPending",
    (select count(*)::integer from registry_lookalike_beacons where chain_id=$1 and error is not null) "beaconFailed"
    from registry_assets a left join registry_lookalike_searches s on s.chain_id=a.chain_id and s.asset_id=a.id and s.symbol=a.symbol
    where a.chain_id=$1 and a.status='active' and a.asset_type=any($2::text[])`, [chainId, SCANNED_TYPES]);
  const row = result.rows[0];
  return { ...row,
    oldestCompletedAt: row.oldestCompletedAt ? new Date(row.oldestCompletedAt).toISOString() : null,
    lastObservedAt: row.lastObservedAt ? new Date(row.lastObservedAt).toISOString() : null,
    localCompletedAt: row.localCompletedAt ? new Date(row.localCompletedAt).toISOString() : null };
}

function errorMessage(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 300);
}

export async function scanLookalikes(chainId: number, dependencies: Dependencies = {}): Promise<RunOutcome> {
  const owner = await pool.connect();
  let locked = false;
  try {
    locked = (await owner.query("select pg_try_advisory_lock($1,hashtext(current_schema()||':lookalikes')) acquired", [chainId])).rows[0].acquired;
    if (!locked) return { rows: 0, detail: { skipped: "another_lookalike_scan_is_running" } };
    const started = Date.now();
    const local = await recordLocalCollisions(chainId, owner);
    const allAssets = await activeAssets(chainId);
    const assets = new Map(allAssets.map((asset) => [asset.id, asset]));
    const canonical = new Set(allAssets.map((asset) => asset.address.toLowerCase()));
    const errors: string[] = [];
    let pages = 0;
    let candidates = 0;
    let added = 0;
    let announced = 0;
    let searchesFailed = 0;
    for (const progress of await dueSearches(chainId, owner)) {
      if (Date.now() - started >= WORK_MS) break;
      const asset = assets.get(progress.asset_id);
      if (!asset) continue;
      await owner.query("update registry_lookalike_searches set attempted_at=now() where chain_id=$1 and asset_id=$2", [chainId, asset.id]);
      try {
        const page = await (dependencies.search ?? searchTokenPage)(asset.symbol, progress.next_page);
        const saved = await savePage(chainId, asset, progress, page, canonical, owner);
        candidates += saved.candidates;
        added += saved.added;
        announced += saved.announced;
        pages++;
      } catch (error) {
        const message = errorMessage(error);
        searchesFailed++;
        errors.push(`${asset.symbol}: ${message}`);
        await owner.query("update registry_lookalike_searches set error=$3 where chain_id=$1 and asset_id=$2", [chainId, asset.id, message]);
        if (error instanceof BlockscoutUnavailableError) break;
      }
    }
    let beacons = { read: 0, failed: 0, retried: 0 };
    if (!errors.length && Date.now() - started < WORK_MS) beacons = await enrichBeacons(chainId, owner, dependencies);
    if (beacons.failed) errors.push(`${beacons.failed} beacon reads failed`);
    const coverage = await getLookalikeCoverage(chainId);
    // Retry cooldowns must not turn a failed source green merely because there
    // was no eligible work this minute.
    if (!errors.length && coverage.failed) errors.push(`${coverage.failed} catalog searches awaiting successful retry`);
    if (!errors.length && coverage.beaconFailed) errors.push(`${coverage.beaconFailed} beacon reads awaiting successful retry`);
    return { rows: local.candidates + candidates, error: errors.length ? errors.join("; ").slice(0, 500) : undefined,
      detail: { assets: coverage.assets, localCandidates: local.candidates, localAdded: local.added,
        localComplete: local.complete, localScanned: local.scanned, explorerCandidates: candidates,
        pages, added, announced, beaconReads: beacons.read, beaconReadsFailed: beacons.failed, beaconRetryReads: beacons.retried,
        searchesFailed, lookalikeCoverage: coverage } };
  } finally {
    if (locked) {
      try { await owner.query("select pg_advisory_unlock($1,hashtext(current_schema()||':lookalikes'))", [chainId]); }
      catch (error) { owner.release(true); throw error; }
    }
    owner.release();
  }
}

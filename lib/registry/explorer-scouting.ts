import type { Pool, PoolClient } from "pg";
import type { PublicClient } from "viem";
import { pool } from "@/lib/db";
import { getMarketReadClient } from "@/lib/chain/rpc";
import { checkRpcBudget } from "@/lib/ratelimit";
import { refreshPriorityMetadata } from "./priority-metadata";
import { BlockscoutUnavailableError, searchTokenPage, type ExplorerCursor, type ExplorerTokenPage } from "./authority/blockscout";
import type { RunOutcome } from "./authority/runs";

export const EXPLORER_SEARCH_BATCH = 8;
export const EXPLORER_VERIFY_BATCH = 12;
const WORK_MS = 40_000;

interface Search {
  symbol: string;
  catalog_at: string;
  next_page: ExplorerCursor | null;
}

interface Dependencies {
  database?: Pool;
  search?: (symbol: string, cursor: ExplorerCursor | null) => Promise<ExplorerTokenPage>;
  verify?: (chainId: number, addresses: string[], client: PublicClient, database: Pool) => Promise<{ read: number; failed: number }>;
  client?: PublicClient;
}

async function dueSearches(chainId: number, database: PoolClient): Promise<Search[]> {
  const rows = await database.query<Search>(`with catalog as (
      select symbol,max(observed_at) catalog_at from robinhood_app_pairs where present group by symbol
    ) select c.symbol,c.catalog_at::text catalog_at,
      case when s.catalog_at=c.catalog_at then s.next_page else null end next_page
    from catalog c left join registry_explorer_searches s on s.chain_id=$1 and s.symbol=c.symbol
    where (s.attempted_at is null or s.attempted_at<now()-interval '5 minutes' or s.error is null)
      and (s.catalog_at is distinct from c.catalog_at or s.next_page is not null
        or s.completed_at is null or s.completed_at<now()-interval '6 hours')
    order by (s.catalog_at is distinct from c.catalog_at) desc,
      s.attempted_at asc nulls first,c.catalog_at desc,c.symbol limit $2`, [chainId, EXPLORER_SEARCH_BATCH]);
  return rows.rows;
}

async function savePage(chainId: number, item: Search, page: ExplorerTokenPage, database: PoolClient): Promise<number> {
  let candidates = 0;
  await database.query("begin");
  try {
    for (const token of page.items) {
      if (token.symbol?.trim().toUpperCase() !== item.symbol.trim().toUpperCase()) continue;
      await database.query(`insert into registry_explorer_candidates(chain_id,address,catalog_symbol,reported_symbol,reported_name)
        values($1,$2,$3,$4,$5) on conflict(chain_id,address) do update set catalog_symbol=excluded.catalog_symbol,
        reported_symbol=excluded.reported_symbol,reported_name=excluded.reported_name,observed_at=now()`,
      [chainId, token.address, item.symbol, token.symbol?.slice(0, 80), token.name?.slice(0, 200)]);
      // Explorer labels nominate an address. Only the pinned RPC reader writes
      // the metadata used for token grouping, capitalization and verification.
      await database.query(`insert into dex_tokens(id,chain_id,address,source) select $1,$2,$3,'blockscout_catalog'
        where not exists(select 1 from dex_tokens where chain_id=$2 and address=$3)
        on conflict(id) do nothing`, [`${chainId}:${token.address}`, chainId, token.address]);
      candidates++;
    }
    await database.query(`update registry_explorer_searches set catalog_at=$3,observed_at=now(),
      next_page=$4,completed_at=case when $4::jsonb is null then now() else completed_at end,error=null
      where chain_id=$1 and symbol=$2`, [chainId, item.symbol, item.catalog_at, page.next]);
    await database.query("commit");
    return candidates;
  } catch (error) {
    await database.query("rollback");
    throw error;
  }
}

async function verificationBatch(chainId: number, database: PoolClient): Promise<string[]> {
  const rows = await database.query<{ address: string }>(`select c.address from registry_explorer_candidates c
    left join registry_token_observations o on o.chain_id=c.chain_id and o.address=c.address
    where c.chain_id=$1 and (c.attempted_at is null or c.attempted_at<now()-interval '15 minutes')
      and not exists(select 1 from registry_assets a where a.chain_id=c.chain_id and a.address=c.address and a.status='active')
      and (o.metadata is null or o.metadata->>'reason' is not null or o.metadata->>'asOf' is null
        or (o.metadata->>'asOf')::timestamptz<now()-interval '1 day' or (o.metadata->>'asOf')::timestamptz>now())
    order by c.attempted_at asc nulls first,c.first_observed_at,c.address limit $2`, [chainId, EXPLORER_VERIFY_BATCH]);
  const addresses = rows.rows.map((row) => row.address);
  if (addresses.length) await database.query(`update registry_explorer_candidates set attempted_at=now()
    where chain_id=$1 and address=any($2::text[])`, [chainId, addresses]);
  return addresses;
}

export async function scoutExplorerCatalog(chainId: number, dependencies: Dependencies = {}): Promise<RunOutcome> {
  if (chainId !== 4663 && !dependencies.database) throw new Error("Explorer catalog scouting supports chain 4663");
  const database = dependencies.database ?? pool;
  const owner = await database.connect();
  let locked = false;
  let pages = 0;
  let candidates = 0;
  let verified = 0;
  let rpcCalls = 0;
  const errors: string[] = [];
  const started = Date.now();
  try {
    locked = (await owner.query("select pg_try_advisory_lock($1,6060) acquired", [chainId])).rows[0].acquired;
    if (!locked) return { rows: 0, detail: { skipped: "another_scout_is_running" } };
    for (const item of await dueSearches(chainId, owner)) {
      if (Date.now() - started >= WORK_MS) break;
      await owner.query(`insert into registry_explorer_searches(chain_id,symbol,attempted_at) values($1,$2,now())
        on conflict(chain_id,symbol) do update set attempted_at=now()`, [chainId, item.symbol]);
      try {
        const page = await (dependencies.search ?? searchTokenPage)(item.symbol, item.next_page);
        candidates += await savePage(chainId, item, page, owner);
        pages++;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Explorer search failed";
        await owner.query("update registry_explorer_searches set error=$3 where chain_id=$1 and symbol=$2", [chainId, item.symbol, message.slice(0, 300)]);
        errors.push(`${item.symbol}: ${message}`);
        if (error instanceof BlockscoutUnavailableError) break;
      }
    }
    const addresses = await verificationBatch(chainId, owner);
    if (addresses.length) {
      try {
        const client = dependencies.client ?? getMarketReadClient(chainId, async function budget() {
          const result = await checkRpcBudget();
          if (result.ok) rpcCalls++;
          return result;
        });
        const result = await (dependencies.verify ?? refreshPriorityMetadata)(chainId, addresses, client, database);
        verified = result.read - result.failed;
        if (result.failed) errors.push(`${result.failed} candidate contract reads incomplete`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Candidate contract verification failed");
      }
    }
    return { rows: verified, error: errors.length ? errors.join("; ").slice(0, 500) : undefined,
      detail: { pages, candidates, verified, rpcCalls, searchBatch: EXPLORER_SEARCH_BATCH, verificationBatch: EXPLORER_VERIFY_BATCH,
        source: "Chain explorer token search followed by pinned RPC verification" } };
  } finally {
    if (locked) {
      try { await owner.query("select pg_advisory_unlock($1,6060)", [chainId]); }
      catch (error) { owner.release(true); throw error; }
    }
    owner.release();
  }
}

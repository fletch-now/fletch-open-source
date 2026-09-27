import { ilike, or, sql, type SQL } from "drizzle-orm";
import { registryAssets } from "@/lib/db/schema";

// One search rule for every registry table: the public page, the dashboard
// and the API. A query matches the ticker, the name, the ISIN or the
// address, and results come back in the order a person means: the exact
// ticker first, then tickers that start with the query, then names that
// start with it, then anything that contains it.

export function normaliseQuery(query: string): string {
  return query.trim().replace(/^\$/, "").replace(/\s+/g, " ").slice(0, 64);
}

export function assetSearchCondition(query: string): SQL | undefined {
  const q = normaliseQuery(query);
  if (!q) {
    return undefined;
  }
  return or(
    ilike(registryAssets.symbol, `%${q}%`),
    ilike(registryAssets.name, `%${q}%`),
    ilike(registryAssets.isin, `${q}%`),
    ilike(registryAssets.address, `${q}%`),
  );
}

export function assetSearchRank(query: string): SQL {
  const q = normaliseQuery(query);
  return sql`case
    when lower(${registryAssets.symbol}) = lower(${q}) then 0
    when lower(${registryAssets.symbol}) like lower(${q}) || '%' then 1
    when lower(${registryAssets.name}) like lower(${q}) || '%' then 2
    when lower(${registryAssets.name}) like '% ' || lower(${q}) || '%' then 3
    else 4
  end`;
}

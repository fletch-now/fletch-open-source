import { pool } from "@/lib/db";
import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { measureScoutingCoverage } from "./scouting";
import { readSwapIndexer } from "./authority/market-swap-status";
import { writeCoverageReceipt } from "./coverage-receipt";

// Existing minute-level membership work publishes the catalog aggregates.
// Page reads never trigger a catalog-wide scan; a stopped worker leaves the
// previous receipt and its original timestamps available as stale evidence.
export async function publishRegistryCoverage(chainId: number, database: Pool = pool): Promise<string> {
  const client = await database.connect();
  try {
    // Aggregate reads share one connection and snapshot. Their server deadline
    // frees the connection on failure, preserving the last complete receipt.
    await client.query("begin isolation level repeatable read");
    await client.query("set local statement_timeout='15s'");
    const now = new Date();
    const scouting = await measureScoutingCoverage(chainId, client);
    const swapIndexer = await readSwapIndexer(chainId, now, drizzle(client));
    const measuredAt = now.toISOString();
    await writeCoverageReceipt(chainId, { version: 1, measuredAt, scouting,
      swapIndexer: { checkedAt: swapIndexer.checkedAt, tiers: swapIndexer.tiers, historicalUsdAvailable: swapIndexer.historicalUsdAvailable } }, client);
    await client.query("commit");
    return measuredAt;
  } catch (cause) {
    await client.query("rollback");
    throw cause;
  } finally {
    client.release();
  }
}

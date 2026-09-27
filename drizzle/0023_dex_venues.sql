-- Other DEXs beside Uniswap v4. A pool row now says which venue it belongs
-- to, because "the price on the DEX" means nothing without it: a v4 pool is
-- an id inside one PoolManager and has no address of its own, while a v3
-- pool is a contract, and the deepest pool for an asset can sit on either.
--
-- Existing rows are all Uniswap v4 discovery, so the default names that
-- venue and nothing has to be backfilled. `pool_address` stays null for v4.
ALTER TABLE "dex_pools" ADD COLUMN IF NOT EXISTS "venue" text DEFAULT 'uniswap_v4' NOT NULL;
ALTER TABLE "dex_pools" ADD COLUMN IF NOT EXISTS "pool_address" text;

CREATE INDEX IF NOT EXISTS "dex_pools_venue_idx" ON "dex_pools" ("chain_id", "venue");

GRANT SELECT, INSERT, UPDATE, DELETE ON "dex_pools", "dex_swaps_daily" TO fletch;

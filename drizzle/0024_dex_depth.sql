-- Depth in dollars, and where a figure is not a count yet.
--
-- Uniswap liquidity L is in units of sqrt(token0_raw * token1_raw), so it is
-- comparable only between pools of the same pair: at the same dollar depth a
-- WETH-quoted pool (18 decimals) reports an L about 10^6 times the one a
-- USDG-quoted pool (6 decimals) reports. Ranking pools on raw L therefore
-- picked the WETH pair whatever its real depth, and that pool set the asset's
-- published price and premium. `depth_usd` is the dollar value of both sides
-- of the pool's virtual reserves at the state read, and it is what the deepest
-- pool is now chosen by.
ALTER TABLE "dex_pools" ADD COLUMN IF NOT EXISTS "depth_usd" numeric;
CREATE INDEX IF NOT EXISTS "dex_pools_asset_depth_idx" ON "dex_pools" ("asset_id", "depth_usd");

-- Swaps are tallied from the block the swap scan had reached when the pool was
-- discovered, so a pool found today has no swap history before that point. A
-- zero there would read as "nothing traded" for what may be the busiest pool
-- on the chain; null says the day has not been counted yet.
ALTER TABLE "dex_pools" ALTER COLUMN "swaps_24h" DROP NOT NULL;

-- The venue and the dollar depth of the pool behind each asset's DEX price,
-- so state.dex answers "where does this price come from and how deep is it"
-- without a join.
ALTER TABLE "registry_asset_state" ADD COLUMN IF NOT EXISTS "dex_venue" text;
ALTER TABLE "registry_asset_state" ADD COLUMN IF NOT EXISTS "dex_depth_usd" numeric;

GRANT SELECT, INSERT, UPDATE, DELETE ON "dex_pools", "registry_asset_state" TO fletch;

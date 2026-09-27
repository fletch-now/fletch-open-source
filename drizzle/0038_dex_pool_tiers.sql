-- Pools are tiered by whether they are worth reading every ten minutes:
-- active (depth or recent swaps), quiet (a little depth, no recent swap),
-- dormant (drained or empty for a month). Nothing is deleted; the tier sets
-- the read cadence and the default view. last_swap_at feeds the rule.
ALTER TABLE dex_pools ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'active';
ALTER TABLE dex_pools ADD COLUMN IF NOT EXISTS last_swap_at timestamp;
CREATE INDEX IF NOT EXISTS dex_pools_chain_tier_idx ON dex_pools (chain_id, tier);
GRANT ALL ON TABLE dex_pools TO fletch;

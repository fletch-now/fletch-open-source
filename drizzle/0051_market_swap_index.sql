-- Independent of discovery migrations 0048/0049. Existing history is preserved.
ALTER TABLE dex_pools ADD COLUMN IF NOT EXISTS canonical boolean NOT NULL DEFAULT true;
ALTER TABLE dex_pools ADD COLUMN IF NOT EXISTS created_block_hash text;
ALTER TABLE dex_pools ADD COLUMN IF NOT EXISTS created_tx_hash text;
ALTER TABLE dex_pools ADD COLUMN IF NOT EXISTS created_log_index integer;
ALTER TABLE dex_pools ADD COLUMN IF NOT EXISTS swaps_indexed_from_block bigint;
ALTER TABLE dex_pools ADD COLUMN IF NOT EXISTS swaps_indexed_from_at timestamp;
ALTER TABLE dex_pools ADD COLUMN IF NOT EXISTS metrics_as_of timestamp;
ALTER TABLE dex_pools ADD COLUMN IF NOT EXISTS transactions_24h integer;
ALTER TABLE dex_pools ALTER COLUMN swaps_24h DROP DEFAULT;
CREATE TABLE IF NOT EXISTS market_swap_events (
  chain_id integer NOT NULL, block_hash text NOT NULL, tx_hash text NOT NULL,
  log_index integer NOT NULL, pool_id text NOT NULL, block_number bigint NOT NULL,
  amount0_raw numeric NOT NULL, amount1_raw numeric NOT NULL,
  canonical boolean NOT NULL DEFAULT true, observed_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id, block_hash, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS market_swap_events_pool_block_idx ON market_swap_events(chain_id,pool_id,block_number) WHERE canonical;
CREATE INDEX IF NOT EXISTS market_swap_events_chain_block_idx ON market_swap_events(chain_id,block_number) WHERE canonical;
CREATE TABLE IF NOT EXISTS market_swap_ranges (
  id text PRIMARY KEY, chain_id integer NOT NULL, pool_id text,
  from_block bigint NOT NULL, through_block bigint NOT NULL,
  from_hash text NOT NULL, through_hash text NOT NULL,
  observed_at timestamp NOT NULL DEFAULT now(), canonical boolean NOT NULL DEFAULT true,
  CHECK(from_block <= through_block)
);
CREATE INDEX IF NOT EXISTS market_swap_ranges_chain_pool_idx ON market_swap_ranges(chain_id,pool_id,through_block);
CREATE TABLE IF NOT EXISTS market_swap_index_state (
  chain_id integer PRIMARY KEY, live_start_block bigint NOT NULL, live_start_at timestamp NOT NULL,
  through_block bigint NOT NULL, through_at timestamp NOT NULL, through_hash text NOT NULL,
  window_start_block bigint NOT NULL, window_start_at timestamp NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS market_pool_swap_metrics (
  chain_id integer NOT NULL, pool_id text NOT NULL,
  enrolled_from_block bigint NOT NULL, covered_from_block bigint NOT NULL,
  factory_created_block bigint NOT NULL, factory_created_hash text,
  as_of_block bigint, as_of_at timestamp, window_start_at timestamp,
  coverage_complete boolean NOT NULL DEFAULT false, swaps integer, transactions integer,
  volume0_raw numeric, volume1_raw numeric, volume_usd numeric,
  PRIMARY KEY(chain_id,pool_id)
);
CREATE INDEX IF NOT EXISTS market_pool_swap_metrics_backfill_idx ON market_pool_swap_metrics(chain_id,covered_from_block);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fletch') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE market_swap_events, market_swap_ranges,
   market_swap_index_state, market_pool_swap_metrics TO fletch;
 END IF;
END $$;

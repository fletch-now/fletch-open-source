ALTER TYPE watcher_kind ADD VALUE IF NOT EXISTS 'listing_event';
CREATE TABLE IF NOT EXISTS robinhood_app_pairs (
  id text PRIMARY KEY,
  symbol text NOT NULL,
  name text NOT NULL,
  pair jsonb NOT NULL,
  present boolean NOT NULL DEFAULT true,
  first_observed_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS robinhood_app_pairs_symbol_idx ON robinhood_app_pairs (symbol);
CREATE TABLE IF NOT EXISTS robinhood_app_sync (
  id text PRIMARY KEY,
  observed_at timestamptz,
  attempted_at timestamptz NOT NULL,
  error text,
  pair_count integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS dex_pools_currency0_idx ON dex_pools (chain_id, currency0);
CREATE INDEX IF NOT EXISTS dex_pools_currency1_idx ON dex_pools (chain_id, currency1);

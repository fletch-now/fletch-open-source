-- Page receipts survive worker restarts; a partial run cannot stand in for a
-- completed catalog search. Beacon absence is an observation, not a cache miss.
CREATE TABLE IF NOT EXISTS registry_lookalike_searches (
  chain_id integer NOT NULL,
  asset_id text NOT NULL,
  symbol text NOT NULL,
  attempted_at timestamptz,
  observed_at timestamptz,
  completed_at timestamptz,
  next_page jsonb,
  error text,
  PRIMARY KEY (chain_id, asset_id)
);
CREATE TABLE IF NOT EXISTS registry_lookalike_local_scan (
  chain_id integer PRIMARY KEY,
  after_address text NOT NULL DEFAULT '',
  completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS registry_lookalike_beacons (
  chain_id integer NOT NULL,
  address text NOT NULL,
  attempted_at timestamptz,
  checked_at timestamptz,
  error text,
  PRIMARY KEY (chain_id, address)
);
CREATE INDEX IF NOT EXISTS dex_tokens_lookalike_scan_idx
  ON dex_tokens (chain_id, address) WHERE checked_at IS NOT NULL;

-- Failed reads back off independently of the last successful observation.
ALTER TABLE dex_pools ADD COLUMN IF NOT EXISTS state_attempted_at timestamp;
ALTER TABLE dex_pools ADD COLUMN IF NOT EXISTS state_retry_at timestamp;
ALTER TABLE dex_pools ADD COLUMN IF NOT EXISTS state_failures integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS dex_pools_state_retry_idx ON dex_pools(chain_id, state_retry_at);

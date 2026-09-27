-- Online production migration: execute this single statement outside a
-- transaction (for example, psql -f), without a wrapping BEGIN or a migration
-- runner transaction. A regular schema push builds the equivalent index for
-- isolated acceptance databases. Existing pool ingestion remains writable.
-- If a prior interrupted build left an invalid index, inspect pg_index and
-- repair that index explicitly before rerunning; IF NOT EXISTS does not repair it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS dex_pools_pending_token_idx
  ON dex_pools (chain_id, token_address)
  WHERE canonical AND token_address IS NOT NULL;

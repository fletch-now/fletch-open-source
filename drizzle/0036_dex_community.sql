-- Every DEX pool on the chain, not only those trading a listed asset: a pool
-- whose other side is an unlisted token keeps the token's address and a null
-- asset. dex_tokens holds what the chain says about those tokens.
ALTER TABLE dex_pools ALTER COLUMN asset_id DROP NOT NULL;
ALTER TABLE dex_pools ADD COLUMN IF NOT EXISTS token_address text;
CREATE INDEX IF NOT EXISTS dex_pools_token_idx ON dex_pools (token_address);
CREATE INDEX IF NOT EXISTS dex_pools_chain_depth_idx ON dex_pools (chain_id, depth_usd DESC NULLS LAST);
CREATE TABLE IF NOT EXISTS dex_tokens (
  id text PRIMARY KEY,
  chain_id integer NOT NULL,
  address text NOT NULL,
  symbol text,
  name text,
  decimals integer,
  total_supply_raw numeric,
  first_seen_at timestamp NOT NULL DEFAULT now(),
  checked_at timestamp,
  error text
);
CREATE INDEX IF NOT EXISTS dex_tokens_chain_idx ON dex_tokens (chain_id, symbol);
GRANT ALL ON TABLE dex_pools TO fletch;
GRANT ALL ON TABLE dex_tokens TO fletch;

CREATE TABLE IF NOT EXISTS registry_explorer_searches (
  chain_id integer NOT NULL,
  symbol text NOT NULL,
  catalog_at timestamptz,
  attempted_at timestamptz,
  observed_at timestamptz,
  completed_at timestamptz,
  next_page jsonb,
  error text,
  PRIMARY KEY (chain_id, symbol)
);
CREATE TABLE IF NOT EXISTS registry_explorer_candidates (
  chain_id integer NOT NULL,
  address text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  catalog_symbol text NOT NULL,
  reported_symbol text,
  reported_name text,
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  observed_at timestamptz NOT NULL DEFAULT now(),
  attempted_at timestamptz,
  PRIMARY KEY (chain_id, address)
);
CREATE INDEX IF NOT EXISTS registry_explorer_candidates_due_idx
  ON registry_explorer_candidates (chain_id, attempted_at, first_observed_at);

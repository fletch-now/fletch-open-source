-- Provenance on discovered tokens: where Fletch first saw one, whether the
-- address holds code, and an operator's spam flag. Rows are never deleted,
-- exactly like registry_assets; hidden only takes a token out of the default
-- listings. registry_assets itself is untouched: Robinhood's list stays
-- Robinhood's list.
ALTER TABLE dex_tokens ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'factory_scan';
ALTER TABLE dex_tokens ADD COLUMN IF NOT EXISTS bytecode_present boolean;
ALTER TABLE dex_tokens ADD COLUMN IF NOT EXISTS first_seen_block bigint;
ALTER TABLE dex_tokens ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

-- Operator settings that outlive a deploy. One row per key; every write is an
-- audit_log entry, like every other operator action.
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now(),
  updated_by text
);

GRANT ALL ON TABLE dex_tokens TO fletch;
GRANT ALL ON TABLE app_settings TO fletch;

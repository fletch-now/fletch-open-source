-- Second source (Blockscout counters) on asset state, and lookalike tokens.
ALTER TABLE "registry_asset_state"
  ADD COLUMN IF NOT EXISTS "blockscout_holders" integer,
  ADD COLUMN IF NOT EXISTS "blockscout_transfers" bigint,
  ADD COLUMN IF NOT EXISTS "blockscout_total_supply_raw" numeric,
  ADD COLUMN IF NOT EXISTS "blockscout_checked_at" timestamp,
  ADD COLUMN IF NOT EXISTS "supply_agreement" text;

CREATE TABLE IF NOT EXISTS "lookalike_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "chain_id" integer NOT NULL,
  "address" text NOT NULL,
  "symbol" text,
  "name" text,
  "decimals" integer,
  "holders" integer,
  "total_supply_raw" numeric,
  "matches_asset_id" text NOT NULL,
  "matches_symbol" text NOT NULL,
  "kind" text NOT NULL,
  "exact_name" boolean DEFAULT false NOT NULL,
  "beacon" text,
  "first_seen_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "lookalike_tokens_asset_idx" ON "lookalike_tokens" ("matches_asset_id", "holders");
CREATE INDEX IF NOT EXISTS "lookalike_tokens_chain_idx" ON "lookalike_tokens" ("chain_id", "holders");

GRANT SELECT, INSERT, UPDATE, DELETE ON "lookalike_tokens" TO fletch;

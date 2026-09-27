-- Registry authority: on-chain state per asset, the issuer's control plane,
-- multiplier and supply events, daily supply snapshots, corporate actions,
-- chain health, and the ETL bookkeeping that makes every figure traceable.
CREATE TABLE IF NOT EXISTS "registry_asset_state" (
  "asset_id" text PRIMARY KEY REFERENCES "registry_assets"("id") ON DELETE CASCADE,
  "chain_id" integer NOT NULL,
  "address" text NOT NULL,
  "ui_multiplier" numeric,
  "new_ui_multiplier" numeric,
  "multiplier_effective_at" timestamp,
  "token_paused" boolean,
  "oracle_paused" boolean,
  "total_supply_raw" numeric,
  "total_supply_ui" numeric,
  "state_checked_at" timestamp,
  "state_error" text,
  "beacon_address" text,
  "implementation_address" text,
  "code_hash" text,
  "canonical" boolean,
  "canonical_checked_at" timestamp,
  "feed_address" text,
  "feed_price" numeric,
  "feed_updated_at" timestamp,
  "feed_stale" boolean,
  "feed_checked_at" timestamp,
  "api_bid" numeric,
  "api_ask" numeric,
  "api_multiplier" numeric,
  "api_trading_halt" boolean,
  "api_daily_volume" numeric,
  "api_checked_at" timestamp,
  "api_error" text,
  "price_divergence_pct" numeric,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "registry_control_events" (
  "id" text PRIMARY KEY,
  "chain_id" integer NOT NULL,
  "block_number" bigint NOT NULL,
  "block_hash" text NOT NULL,
  "tx_hash" text NOT NULL,
  "log_index" integer NOT NULL,
  "event" text NOT NULL,
  "account" text,
  "role" text,
  "implementation" text,
  "observed_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "registry_control_events_block_idx" ON "registry_control_events" ("chain_id", "block_number");
CREATE INDEX IF NOT EXISTS "registry_control_events_account_idx" ON "registry_control_events" ("account");
CREATE TABLE IF NOT EXISTS "registry_control_state" (
  "chain_id" integer PRIMARY KEY,
  "registry_address" text NOT NULL,
  "implementation" text,
  "paused" boolean,
  "blocked_count" integer,
  "last_event_block" bigint,
  "checked_at" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "registry_multiplier_events" (
  "id" text PRIMARY KEY,
  "asset_id" text REFERENCES "registry_assets"("id") ON DELETE CASCADE,
  "chain_id" integer NOT NULL,
  "address" text NOT NULL,
  "block_number" bigint NOT NULL,
  "tx_hash" text NOT NULL,
  "log_index" integer NOT NULL,
  "old_multiplier" numeric NOT NULL,
  "new_multiplier" numeric NOT NULL,
  "effective_at" timestamp NOT NULL,
  "observed_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "registry_multiplier_events_asset_idx" ON "registry_multiplier_events" ("asset_id", "block_number");
CREATE TABLE IF NOT EXISTS "registry_supply_events" (
  "id" text PRIMARY KEY,
  "asset_id" text REFERENCES "registry_assets"("id") ON DELETE CASCADE,
  "chain_id" integer NOT NULL,
  "address" text NOT NULL,
  "block_number" bigint NOT NULL,
  "tx_hash" text NOT NULL,
  "log_index" integer NOT NULL,
  "kind" text NOT NULL,
  "counterparty" text NOT NULL,
  "value_raw" numeric NOT NULL,
  "observed_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "registry_supply_events_asset_idx" ON "registry_supply_events" ("asset_id", "block_number");
CREATE TABLE IF NOT EXISTS "registry_supply_snapshots" (
  "id" text PRIMARY KEY,
  "asset_id" text NOT NULL REFERENCES "registry_assets"("id") ON DELETE CASCADE,
  "day" text NOT NULL,
  "total_supply_raw" numeric NOT NULL,
  "minted_raw" numeric NOT NULL,
  "burned_raw" numeric NOT NULL,
  "residual_raw" numeric NOT NULL,
  "head_block" bigint NOT NULL,
  "taken_at" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "registry_corporate_actions" (
  "id" text PRIMARY KEY,
  "symbol" text NOT NULL,
  "asset_id" text REFERENCES "registry_assets"("id") ON DELETE SET NULL,
  "kind" text NOT NULL,
  "status" text NOT NULL,
  "process_date" text,
  "rate" numeric,
  "payload" jsonb NOT NULL,
  "first_seen_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "registry_corporate_actions_symbol_idx" ON "registry_corporate_actions" ("symbol", "process_date");
CREATE TABLE IF NOT EXISTS "chain_health" (
  "id" text PRIMARY KEY,
  "chain_id" integer NOT NULL,
  "checked_at" timestamp NOT NULL DEFAULT now(),
  "head_block" bigint NOT NULL,
  "block_time_ms" integer,
  "base_fee_wei" numeric,
  "l1_block" bigint,
  "batch_count" bigint,
  "delayed_messages" bigint,
  "batch_poster_balance_wei" numeric,
  "status_page" text,
  "detail" jsonb
);
CREATE INDEX IF NOT EXISTS "chain_health_recent_idx" ON "chain_health" ("chain_id", "checked_at");
CREATE TABLE IF NOT EXISTS "sync_checkpoints" (
  "name" text PRIMARY KEY,
  "chain_id" integer NOT NULL,
  "block_number" bigint NOT NULL,
  "block_hash" text NOT NULL,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "sync_runs" (
  "id" text PRIMARY KEY,
  "job" text NOT NULL,
  "started_at" timestamp NOT NULL DEFAULT now(),
  "finished_at" timestamp,
  "ok" boolean,
  "rows" integer,
  "error" text,
  "detail" jsonb
);
CREATE INDEX IF NOT EXISTS "sync_runs_job_idx" ON "sync_runs" ("job", "started_at");

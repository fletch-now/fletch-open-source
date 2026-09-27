-- A daily snapshot of every per-asset number the registry publishes, so the
-- live tables can keep only "now" while history stays answerable.
CREATE TABLE IF NOT EXISTS "asset_state_daily" (
  "id" text PRIMARY KEY NOT NULL,
  "asset_id" text NOT NULL,
  "day" text NOT NULL,
  "ui_multiplier" numeric,
  "token_paused" boolean,
  "oracle_paused" boolean,
  "api_trading_halt" boolean,
  "feed_price" numeric,
  "feed_stale" boolean,
  "api_bid" numeric,
  "api_ask" numeric,
  "price_divergence_pct" numeric,
  "dex_price_usd" numeric,
  "dex_premium_pct" numeric,
  "dex_liquidity" numeric,
  "total_supply_raw" numeric,
  "blockscout_holders" integer,
  "ledger_holders" integer,
  "lookalikes" integer,
  "taken_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "asset_state_daily_asset_idx" ON "asset_state_daily" ("asset_id", "day");
CREATE INDEX IF NOT EXISTS "asset_state_daily_day_idx" ON "asset_state_daily" ("day");

GRANT SELECT, INSERT, UPDATE, DELETE ON "asset_state_daily" TO fletch;

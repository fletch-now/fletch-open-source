-- Uniswap v4 pools, daily swaps, and the DEX price beside each asset's state.
ALTER TABLE "registry_asset_state"
  ADD COLUMN IF NOT EXISTS "dex_pool_id" text,
  ADD COLUMN IF NOT EXISTS "dex_price_usd" numeric,
  ADD COLUMN IF NOT EXISTS "dex_liquidity" numeric,
  ADD COLUMN IF NOT EXISTS "dex_premium_pct" numeric,
  ADD COLUMN IF NOT EXISTS "dex_checked_at" timestamp;

CREATE TABLE IF NOT EXISTS "dex_pools" (
  "id" text PRIMARY KEY NOT NULL,
  "chain_id" integer NOT NULL,
  "currency0" text NOT NULL,
  "currency1" text NOT NULL,
  "fee" integer NOT NULL,
  "tick_spacing" integer NOT NULL,
  "hooks" text NOT NULL,
  "asset_id" text NOT NULL,
  "quote_asset_id" text,
  "created_block" bigint NOT NULL,
  "sqrt_price_x96" numeric,
  "tick" integer,
  "liquidity" numeric,
  "price_in_quote" numeric,
  "price_usd" numeric,
  "state_checked_at" timestamp,
  "swaps_24h" integer DEFAULT 0 NOT NULL,
  "volume_usd_24h" numeric,
  "first_seen_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "dex_pools_asset_idx" ON "dex_pools" ("asset_id", "liquidity");
CREATE INDEX IF NOT EXISTS "dex_pools_chain_idx" ON "dex_pools" ("chain_id");

CREATE TABLE IF NOT EXISTS "dex_swaps_daily" (
  "id" text PRIMARY KEY NOT NULL,
  "pool_id" text NOT NULL,
  "day" text NOT NULL,
  "swaps" integer DEFAULT 0 NOT NULL,
  "volume0_raw" numeric DEFAULT 0 NOT NULL,
  "volume1_raw" numeric DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "dex_swaps_daily_pool_idx" ON "dex_swaps_daily" ("pool_id", "day");

GRANT SELECT, INSERT, UPDATE, DELETE ON "dex_pools", "dex_swaps_daily" TO fletch;

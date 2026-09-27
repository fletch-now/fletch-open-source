-- Holder ledger, daily activity and concentration.
CREATE TABLE IF NOT EXISTS "holder_balances" (
  "asset_id" text NOT NULL,
  "holder" text NOT NULL,
  "raw_balance" numeric NOT NULL,
  "updated_block" bigint NOT NULL,
  PRIMARY KEY ("asset_id", "holder")
);
CREATE INDEX IF NOT EXISTS "holder_balances_top_idx" ON "holder_balances" ("asset_id", "raw_balance");

CREATE TABLE IF NOT EXISTS "asset_activity_daily" (
  "id" text PRIMARY KEY NOT NULL,
  "asset_id" text NOT NULL,
  "day" text NOT NULL,
  "transfers" integer DEFAULT 0 NOT NULL,
  "volume_raw" numeric DEFAULT 0 NOT NULL,
  "mints" integer DEFAULT 0 NOT NULL,
  "burns" integer DEFAULT 0 NOT NULL,
  "dvp_transfers" integer DEFAULT 0 NOT NULL,
  "offhours_transfers" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "asset_activity_daily_asset_idx" ON "asset_activity_daily" ("asset_id", "day");

CREATE TABLE IF NOT EXISTS "asset_concentration" (
  "id" text PRIMARY KEY NOT NULL,
  "asset_id" text NOT NULL,
  "day" text NOT NULL,
  "holders" integer NOT NULL,
  "top1_pct" numeric,
  "top10_pct" numeric,
  "gini" numeric,
  "issuer_pct" numeric,
  "issuer_address" text,
  "head_block" bigint NOT NULL,
  "taken_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "asset_concentration_asset_idx" ON "asset_concentration" ("asset_id", "day");

GRANT SELECT, INSERT, UPDATE, DELETE ON "holder_balances", "asset_activity_daily", "asset_concentration" TO fletch;

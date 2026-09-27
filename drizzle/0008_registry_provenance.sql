ALTER TABLE "registry_assets" ADD COLUMN IF NOT EXISTS "first_seen_at" timestamp NOT NULL DEFAULT now();
ALTER TABLE "registry_assets" ADD COLUMN IF NOT EXISTS "onchain_name" text;
ALTER TABLE "registry_assets" ADD COLUMN IF NOT EXISTS "onchain_symbol" text;
ALTER TABLE "registry_assets" ADD COLUMN IF NOT EXISTS "onchain_decimals" integer;
ALTER TABLE "registry_assets" ADD COLUMN IF NOT EXISTS "metadata_checked_at" timestamp;
ALTER TABLE "registry_assets" ADD COLUMN IF NOT EXISTS "logo_url" text;
ALTER TABLE "registry_assets" ADD COLUMN IF NOT EXISTS "isin" text;
CREATE INDEX IF NOT EXISTS "registry_assets_first_seen_idx" ON "registry_assets" ("chain_id", "first_seen_at");

-- Existing rows were first seen when they were first observed, which is the
-- closest honest value; new rows get their real first sight.
UPDATE "registry_assets" SET "first_seen_at" = "observed_at" WHERE "first_seen_at" > "observed_at";

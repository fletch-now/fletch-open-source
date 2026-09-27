-- Chainlink round history per feed.
CREATE TABLE IF NOT EXISTS "feed_rounds" (
  "id" text PRIMARY KEY NOT NULL,
  "chain_id" integer NOT NULL,
  "feed_address" text NOT NULL,
  "asset_id" text,
  "symbol" text,
  "round_id" numeric NOT NULL,
  "answer" numeric NOT NULL,
  "started_at" timestamp,
  "updated_at" timestamp NOT NULL,
  "observed_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "feed_rounds_feed_idx" ON "feed_rounds" ("feed_address", "round_id");
CREATE INDEX IF NOT EXISTS "feed_rounds_asset_idx" ON "feed_rounds" ("asset_id", "updated_at");

GRANT SELECT, INSERT, UPDATE, DELETE ON "feed_rounds" TO fletch;

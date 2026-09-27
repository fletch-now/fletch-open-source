-- Authority events: the append-only stream every alert, changelog entry and
-- SSE frame is read from. Two new watcher kinds subscribe to it.
CREATE TABLE IF NOT EXISTS "authority_events" (
  "id" text PRIMARY KEY NOT NULL,
  "chain_id" integer NOT NULL,
  "kind" text NOT NULL,
  "asset_id" text,
  "address" text,
  "symbol" text,
  "title" text NOT NULL,
  "detail" jsonb,
  "block_number" bigint,
  "tx_hash" text,
  "occurred_at" timestamp NOT NULL,
  "observed_at" timestamp DEFAULT now() NOT NULL,
  "matched_at" timestamp
);
CREATE INDEX IF NOT EXISTS "authority_events_recent_idx" ON "authority_events" ("chain_id", "observed_at");
CREATE INDEX IF NOT EXISTS "authority_events_asset_idx" ON "authority_events" ("asset_id", "observed_at");
CREATE INDEX IF NOT EXISTS "authority_events_unmatched_idx" ON "authority_events" ("matched_at") WHERE matched_at IS NULL;

ALTER TYPE "watcher_kind" ADD VALUE IF NOT EXISTS 'registry_event';
ALTER TYPE "watcher_kind" ADD VALUE IF NOT EXISTS 'token_event';

GRANT SELECT, INSERT, UPDATE, DELETE ON "authority_events" TO fletch;

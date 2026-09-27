DO $$ BEGIN CREATE TYPE "watcher_kind" AS ENUM ('large_transfer'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "watcher_status" AS ENUM ('active', 'catching_up', 'degraded', 'paused'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "delivery_status" AS ENUM ('pending', 'sent', 'failed', 'retracted'); EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "registry_assets" (
  "id" text PRIMARY KEY NOT NULL,
  "chain_id" integer NOT NULL,
  "address" text NOT NULL,
  "symbol" text NOT NULL,
  "name" text NOT NULL,
  "asset_type" text NOT NULL,
  "decimals" integer DEFAULT 18 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "source" text NOT NULL,
  "source_uri" text,
  "observed_at" timestamp DEFAULT now() NOT NULL,
  "verified_at" timestamp,
  "raw" jsonb
);
CREATE INDEX IF NOT EXISTS "registry_assets_symbol_idx" ON "registry_assets" ("chain_id", "symbol");

CREATE TABLE IF NOT EXISTS "watchers" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "project_id" text REFERENCES "projects"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "kind" "watcher_kind" DEFAULT 'large_transfer' NOT NULL,
  "chain_id" integer NOT NULL,
  "address" text NOT NULL,
  "asset_id" text REFERENCES "registry_assets"("id"),
  "threshold" numeric NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "status" "watcher_status" DEFAULT 'catching_up' NOT NULL,
  "last_checked_block" bigint,
  "last_checked_block_hash" text,
  "last_triggered_at" timestamp,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "watchers_user_id_idx" ON "watchers" ("user_id");
CREATE INDEX IF NOT EXISTS "watchers_target_idx" ON "watchers" ("chain_id", "address");

CREATE TABLE IF NOT EXISTS "watcher_deliveries" (
  "id" text PRIMARY KEY NOT NULL,
  "watcher_id" text NOT NULL REFERENCES "watchers"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "tx_hash" text NOT NULL,
  "log_index" integer NOT NULL,
  "block_number" bigint NOT NULL,
  "block_hash" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" "delivery_status" DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp DEFAULT now() NOT NULL,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "sent_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "watcher_deliveries_event_idx" ON "watcher_deliveries" ("watcher_id", "tx_hash", "log_index");
CREATE INDEX IF NOT EXISTS "watcher_deliveries_queue_idx" ON "watcher_deliveries" ("status", "next_attempt_at");

CREATE TABLE IF NOT EXISTS "telegram_accounts" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "chat_id" text NOT NULL,
  "username" text,
  "linked_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "telegram_link_tokens" (
  "token" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp
);

CREATE TABLE IF NOT EXISTS "daemon_heartbeats" (
  "name" text PRIMARY KEY NOT NULL,
  "last_beat_at" timestamp DEFAULT now() NOT NULL,
  "head_block" bigint,
  "detail" jsonb
);

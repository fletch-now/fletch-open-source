-- Issuer paperwork, watched pages, and finality/governance on chain health.
ALTER TABLE "chain_health"
  ADD COLUMN IF NOT EXISTS "arbos_version" integer,
  ADD COLUMN IF NOT EXISTS "chain_owners" jsonb,
  ADD COLUMN IF NOT EXISTS "latest_confirmed_assertion" text,
  ADD COLUMN IF NOT EXISTS "confirmed_at_l1_block" bigint,
  ADD COLUMN IF NOT EXISTS "confirmed_age_seconds" integer;

CREATE TABLE IF NOT EXISTS "issuer_documents" (
  "url" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "kind" text NOT NULL,
  "underlying" text,
  "asset_id" text,
  "etag" text,
  "last_modified" timestamp,
  "bytes" bigint,
  "first_seen_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "changed_at" timestamp,
  "gone_at" timestamp
);

CREATE TABLE IF NOT EXISTS "issuer_pages" (
  "slug" text PRIMARY KEY NOT NULL,
  "url" text NOT NULL,
  "title" text,
  "sha256" text NOT NULL,
  "excerpt" text,
  "first_seen_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "changed_at" timestamp
);

GRANT SELECT, INSERT, UPDATE, DELETE ON "issuer_documents", "issuer_pages" TO fletch;

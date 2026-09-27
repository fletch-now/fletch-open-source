CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "prefix" text NOT NULL,
  "hash" text NOT NULL UNIQUE,
  "scopes" jsonb NOT NULL,
  "last_used_at" timestamp,
  "revoked_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "api_keys_user_id_idx" ON "api_keys" ("user_id");

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "actor_type" text NOT NULL,
  "actor_id" text,
  "action" text NOT NULL,
  "resource_type" text,
  "resource_id" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "audit_log_user_idx" ON "audit_log" ("user_id", "created_at");

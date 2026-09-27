-- Admin unlocks by nonce, so Lock revokes an unlock everywhere.
CREATE TABLE IF NOT EXISTS "admin_sessions" (
  "nonce" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "revoked_at" timestamp
);
GRANT SELECT, INSERT, UPDATE, DELETE ON "admin_sessions" TO fletch;

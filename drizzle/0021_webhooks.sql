-- Webhook delivery for watchers: an account registers an HTTPS endpoint and a
-- watcher sends its alerts there instead of Telegram. The signing secret is
-- stored encrypted (lib/telegram/secret.ts, AES-256-GCM) because the daemon
-- needs the plaintext at send time to sign the body; it is shown to the person
-- once at creation and can only be replaced, never read back.
CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "secret_enc" text NOT NULL,
  -- The first characters of the secret ("whsec_xxxx…"), so the dashboard can
  -- name which secret an endpoint is signing with without decrypting it.
  "secret_prefix" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_delivered_at" timestamp,
  "last_error" text
);

DO $$ BEGIN
  ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "webhook_endpoints_user_idx" ON "webhook_endpoints" ("user_id");

-- Existing watchers all deliver to Telegram, which the default preserves.
ALTER TABLE "watchers" ADD COLUMN IF NOT EXISTS "delivery" text DEFAULT 'telegram' NOT NULL;
ALTER TABLE "watchers" ADD COLUMN IF NOT EXISTS "webhook_id" text;

DO $$ BEGIN
  ALTER TABLE "watchers" ADD CONSTRAINT "watchers_webhook_id_webhook_endpoints_id_fk"
    FOREIGN KEY ("webhook_id") REFERENCES "webhook_endpoints"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON "webhook_endpoints" TO fletch;

-- Added after review: lastError alone cannot say whether an endpoint is failing
-- now or failed once weeks ago. Idempotent, so re-running this file is safe.
ALTER TABLE "webhook_endpoints" ADD COLUMN IF NOT EXISTS "last_error_at" timestamp;

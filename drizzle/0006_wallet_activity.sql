ALTER TYPE "watcher_kind" ADD VALUE IF NOT EXISTS 'wallet_activity';
ALTER TABLE "watchers" ADD COLUMN IF NOT EXISTS "wallet" text;
CREATE INDEX IF NOT EXISTS "watchers_wallet_idx" ON "watchers" ("chain_id", "wallet");

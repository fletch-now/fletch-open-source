-- Indexes for the dashboard's ordered per-user and per-watcher reads.
CREATE INDEX IF NOT EXISTS "builds_user_recent_idx" ON "builds" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "credit_events_user_recent_idx" ON "credit_events" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "watcher_deliveries_user_recent_idx" ON "watcher_deliveries" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "watcher_deliveries_watcher_recent_idx" ON "watcher_deliveries" ("watcher_id", "created_at");

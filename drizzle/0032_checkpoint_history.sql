-- Checkpoint movement over time, for rates and stall detection.
CREATE TABLE IF NOT EXISTS "sync_checkpoint_history" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "block_number" bigint NOT NULL,
  "at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "sync_checkpoint_history_name_at_idx" ON "sync_checkpoint_history" ("name", "at");

GRANT SELECT, INSERT, UPDATE, DELETE ON "sync_checkpoint_history" TO fletch;

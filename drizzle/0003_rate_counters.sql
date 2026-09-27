CREATE TABLE IF NOT EXISTS "rate_counters" (
  "bucket" text PRIMARY KEY NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "window_start" timestamp DEFAULT now() NOT NULL
);

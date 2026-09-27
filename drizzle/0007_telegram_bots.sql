CREATE TABLE IF NOT EXISTS "telegram_bots" (
  "user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "token_enc" text NOT NULL,
  "bot_id" text NOT NULL,
  "bot_username" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_checked_at" timestamp
);

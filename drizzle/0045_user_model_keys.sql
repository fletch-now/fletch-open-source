-- A model key someone brought themselves. Encrypted at rest with the same
-- AES-256-GCM helper as Telegram tokens, so a database dump alone yields
-- nothing usable. One key per provider per account; the prefix is stored in
-- clear so a person can tell two keys apart without the key being readable.
CREATE TABLE IF NOT EXISTS user_model_keys (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text,
  key_prefix text NOT NULL,
  encrypted_key text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  last_used_at timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS user_model_keys_owner_idx ON user_model_keys (user_id, provider);
GRANT ALL ON TABLE user_model_keys TO fletch;

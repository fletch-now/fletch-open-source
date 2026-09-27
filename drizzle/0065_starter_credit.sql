-- Activation is a separate, one-time app_setting written at launch cutover.
SET lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS starter_credit_claims (
  address text PRIMARY KEY CHECK (address ~ '^0x[0-9a-f]{40}$'),
  user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
-- A previously credited address cannot claim again through a new account.
INSERT INTO starter_credit_claims(address,user_id,claimed_at)
SELECT DISTINCT ON (lower(w.address)) lower(w.address),w.user_id,c.created_at AT TIME ZONE 'UTC'
FROM wallet_address w JOIN credit_events c ON c.user_id=w.user_id
WHERE c.reason='free_grant' AND lower(w.address) ~ '^0x[0-9a-f]{40}$'
ORDER BY lower(w.address),c.created_at,c.id
ON CONFLICT(address) DO NOTHING;

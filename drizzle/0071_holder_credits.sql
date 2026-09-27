SET lock_timeout = '5s';
ALTER TYPE credit_reason ADD VALUE IF NOT EXISTS 'holder_grant';

CREATE TABLE IF NOT EXISTS holder_credit_claims (
  id text PRIMARY KEY,
  campaign text NOT NULL,
  period text NOT NULL,
  address text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  account_key text NOT NULL,
  user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  policy jsonb NOT NULL,
  evidence jsonb NOT NULL,
  credits integer NOT NULL CHECK (credits = 10),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(campaign,period,address),
  UNIQUE(campaign,period,account_key)
);
CREATE INDEX IF NOT EXISTS holder_credit_claims_created_idx ON holder_credit_claims(campaign,created_at);
CREATE TABLE IF NOT EXISTS holder_credit_checks (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  period text NOT NULL,
  wallet text NOT NULL,
  lease text,
  next_check_at timestamptz NOT NULL,
  result jsonb NOT NULL
);

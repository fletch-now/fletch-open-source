CREATE TABLE IF NOT EXISTS model_gateways (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 provider text NOT NULL, model text NOT NULL, label text NOT NULL, version integer NOT NULL DEFAULT 1,
 pairing_hash text, pairing_expires_at timestamp NOT NULL, token_hash text,
 paired_at timestamp, revoked_at timestamp, last_seen_at timestamp, created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS model_gateways_pairing_idx ON model_gateways(pairing_hash) WHERE pairing_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS model_gateways_token_idx ON model_gateways(token_hash) WHERE token_hash IS NOT NULL;
CREATE TABLE IF NOT EXISTS gateway_requests (
 id text PRIMARY KEY, gateway_id text NOT NULL REFERENCES model_gateways(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 build_id text NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
 payload jsonb NOT NULL, result jsonb, status text NOT NULL DEFAULT 'pending', response_hash text,
 expires_at timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gateway_requests_poll_idx ON gateway_requests(gateway_id, status, created_at);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fletch') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE model_gateways, gateway_requests TO fletch;
  END IF;
END $$;

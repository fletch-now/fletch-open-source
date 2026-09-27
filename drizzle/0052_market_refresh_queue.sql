CREATE TABLE IF NOT EXISTS market_refresh_requests (
 id text PRIMARY KEY, chain_id integer NOT NULL, kind text NOT NULL CHECK (kind IN ('pool', 'token')),
 target text NOT NULL, pending boolean NOT NULL DEFAULT true,
 priority numeric(38,2) NOT NULL DEFAULT 0, requested_at timestamptz NOT NULL DEFAULT now(),
 next_attempt_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0,
 lease_token text, lease_until timestamptz, completed_at timestamptz, last_error text
);
CREATE INDEX IF NOT EXISTS market_refresh_due_idx ON market_refresh_requests(chain_id,kind,next_attempt_at,priority DESC) WHERE pending;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fletch') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE market_refresh_requests TO fletch;
 END IF;
END $$;

-- Staged worker foundation. Existing execution and credit tables are unchanged.
CREATE TABLE IF NOT EXISTS build_worker_jobs (
  build_id text PRIMARY KEY REFERENCES builds(id) ON DELETE RESTRICT,
  workspace_key text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','recovery_required','completed','stopped')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  owner_id text,
  fence text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  stop_requested_at timestamptz,
  last_seq integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  checkpoint_hash text,
  recovery_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (state <> 'running' OR (owner_id IS NOT NULL AND fence IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS build_worker_workspace_owner_idx
  ON build_worker_jobs(workspace_key) WHERE state IN ('running','recovery_required');
CREATE INDEX IF NOT EXISTS build_worker_queue_idx ON build_worker_jobs(state,created_at,build_id);

CREATE TABLE IF NOT EXISTS build_worker_events (
  build_id text NOT NULL REFERENCES build_worker_jobs(build_id) ON DELETE RESTRICT,
  seq integer NOT NULL,
  attempt integer NOT NULL,
  kind text NOT NULL,
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (build_id,seq)
);

CREATE TABLE IF NOT EXISTS build_worker_effects (
  build_id text NOT NULL REFERENCES build_worker_jobs(build_id) ON DELETE RESTRICT,
  effect_key text NOT NULL,
  attempt integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('model','tool','deployment','publication')),
  checkpoint_hash text NOT NULL,
  state text NOT NULL DEFAULT 'uncertain' CHECK (state IN ('uncertain','completed')),
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (build_id,effect_key)
);

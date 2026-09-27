CREATE TABLE IF NOT EXISTS site_drafts (
  build_id text PRIMARY KEY REFERENCES builds(id) ON DELETE RESTRICT,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug text NOT NULL,
  manifest jsonb NOT NULL,
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 10485760),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS site_drafts_project_idx ON site_drafts(project_id,created_at DESC,build_id);
CREATE TABLE IF NOT EXISTS site_publications (
  build_id text PRIMARY KEY REFERENCES site_drafts(build_id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('queued','publishing','published','failed')),
  attempts integer NOT NULL DEFAULT 0,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  previous_release text,
  url text
);
CREATE UNIQUE INDEX IF NOT EXISTS site_publications_active_project_idx
  ON site_publications(project_id) WHERE state IN ('queued','publishing');
CREATE INDEX IF NOT EXISTS site_publications_queue_idx ON site_publications(state,requested_at);

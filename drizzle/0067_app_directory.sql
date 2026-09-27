CREATE TABLE IF NOT EXISTS app_listings (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 60),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 20 AND 160),
  description text NOT NULL CHECK (char_length(description) BETWEEN 60 AND 2400),
  opted_in boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','pending','approved','rejected','suspended')),
  version integer NOT NULL DEFAULT 1,
  build_id text REFERENCES builds(id) ON DELETE CASCADE,
  token_contract_id text REFERENCES contracts(id) ON DELETE SET NULL,
  token_evidence jsonb,
  featured boolean NOT NULL DEFAULT false,
  review_note text CHECK (char_length(review_note) <= 500),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  first_listed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  search_document tsvector GENERATED ALWAYS AS
    (to_tsvector('simple', title || ' ' || summary || ' ' || description)) STORED,
  CHECK (state <> 'approved' OR (opted_in AND build_id IS NOT NULL)),
  CHECK (token_contract_id IS NULL OR token_evidence IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS app_listings_browse_idx ON app_listings(featured DESC,first_listed_at DESC,project_id) WHERE opted_in AND state='approved';
CREATE INDEX IF NOT EXISTS app_listings_review_idx ON app_listings(state,submitted_at DESC);
CREATE INDEX IF NOT EXISTS app_listings_search_idx ON app_listings USING gin(search_document);
CREATE INDEX IF NOT EXISTS site_publications_published_project_idx ON site_publications(project_id,finished_at DESC,build_id DESC) WHERE state='published';
CREATE INDEX IF NOT EXISTS builds_project_created_idx ON builds(project_id,created_at DESC) WHERE project_id IS NOT NULL;

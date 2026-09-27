-- Inactive until an operator publishes reviewed fixed package prices.
ALTER TYPE build_status ADD VALUE IF NOT EXISTS 'paused';
ALTER TYPE credit_reason ADD VALUE IF NOT EXISTS 'build_reserve';
ALTER TYPE credit_reason ADD VALUE IF NOT EXISTS 'build_release';
ALTER TABLE builds ADD COLUMN IF NOT EXISTS pricing_quote_id text;
ALTER TABLE builds ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS builds_pricing_quote_unique ON builds(pricing_quote_id) WHERE pricing_quote_id IS NOT NULL;
ALTER TABLE build_worker_jobs DROP CONSTRAINT IF EXISTS build_worker_jobs_state_check;
ALTER TABLE build_worker_jobs ADD CONSTRAINT build_worker_jobs_state_check CHECK(state IN ('queued','running','recovery_required','paused_budget','completed','stopped'));
DROP INDEX IF EXISTS build_worker_workspace_owner_idx;
CREATE UNIQUE INDEX build_worker_workspace_owner_idx ON build_worker_jobs(workspace_key) WHERE state IN ('running','recovery_required','paused_budget');

CREATE TABLE IF NOT EXISTS build_pricing_quotes (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
 project_id text, build_id text REFERENCES builds(id) ON DELETE RESTRICT,
 fingerprint text NOT NULL, digest text NOT NULL, snapshot jsonb NOT NULL,
 prior_authorization_id text, issued_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 accepted_build_id text REFERENCES builds(id) ON DELETE RESTRICT, accepted_at timestamptz
);
CREATE INDEX IF NOT EXISTS build_pricing_quotes_owner_recent_idx ON build_pricing_quotes(user_id,issued_at);
CREATE TABLE IF NOT EXISTS build_budget_authorizations (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
 build_id text NOT NULL REFERENCES builds(id) ON DELETE RESTRICT,
 quote_id text NOT NULL UNIQUE REFERENCES build_pricing_quotes(id) ON DELETE RESTRICT,
 prior_authorization_id text REFERENCES build_budget_authorizations(id) ON DELETE RESTRICT,
 packages integer NOT NULL CHECK(packages BETWEEN 1 AND 10),
 incremental_credits integer NOT NULL CHECK(incremental_credits BETWEEN 0 AND 10000),
 cumulative_credits integer NOT NULL CHECK(cumulative_credits BETWEEN 0 AND 10000 AND cumulative_credits>=incremental_credits),
 allowance jsonb NOT NULL, client_request_id text NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(user_id,client_request_id),UNIQUE(build_id,packages)
);
CREATE TABLE IF NOT EXISTS build_budget_usage (
 build_id text NOT NULL REFERENCES builds(id) ON DELETE RESTRICT,
 effect_key text NOT NULL, kind text NOT NULL CHECK(kind IN ('model_request','tool_run','active_time')),
 units integer NOT NULL CHECK(units>=0), observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(build_id,effect_key,kind)
);
CREATE TABLE IF NOT EXISTS build_pricing_settlements (
 build_id text PRIMARY KEY REFERENCES builds(id) ON DELETE RESTRICT,
 outcome text NOT NULL CHECK(outcome IN ('succeeded','failed','stopped')),
 charged_credits integer NOT NULL CHECK(charged_credits>=0),released_credits integer NOT NULL CHECK(released_credits>=0),
 settled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION fletch_pricing_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Accepted pricing and accounting evidence is immutable'; END $$;
CREATE TRIGGER build_authorizations_immutable BEFORE UPDATE OR DELETE ON build_budget_authorizations FOR EACH ROW EXECUTE FUNCTION fletch_pricing_append_only();
CREATE TRIGGER build_usage_immutable BEFORE UPDATE OR DELETE ON build_budget_usage FOR EACH ROW EXECUTE FUNCTION fletch_pricing_append_only();
CREATE TRIGGER build_settlements_immutable BEFORE UPDATE OR DELETE ON build_pricing_settlements FOR EACH ROW EXECUTE FUNCTION fletch_pricing_append_only();
CREATE OR REPLACE FUNCTION fletch_pricing_policy_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.key LIKE 'build.pricing.policy.%' THEN RAISE EXCEPTION 'Published pricing is immutable'; END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER published_pricing_immutable BEFORE UPDATE OR DELETE ON app_settings FOR EACH ROW EXECUTE FUNCTION fletch_pricing_policy_immutable();
CREATE OR REPLACE FUNCTION fletch_build_pricing_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.pricing_snapshot IS DISTINCT FROM NEW.pricing_snapshot OR OLD.pricing_quote_id IS DISTINCT FROM NEW.pricing_quote_id THEN RAISE EXCEPTION 'Accepted build pricing is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER accepted_build_pricing_immutable BEFORE UPDATE ON builds FOR EACH ROW EXECUTE FUNCTION fletch_build_pricing_immutable();
CREATE OR REPLACE FUNCTION fletch_pricing_quote_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.accepted_at IS NOT NULL OR
 (to_jsonb(OLD)-'accepted_at'-'accepted_build_id') IS DISTINCT FROM (to_jsonb(NEW)-'accepted_at'-'accepted_build_id') THEN RAISE EXCEPTION 'Issued pricing quote is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pricing_quotes_immutable BEFORE UPDATE OR DELETE ON build_pricing_quotes FOR EACH ROW EXECUTE FUNCTION fletch_pricing_quote_immutable();

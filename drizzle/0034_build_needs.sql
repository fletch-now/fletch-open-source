-- The needs analysis (contract? wallet?) decided before the agent runs, and
-- whether the agent kept what the verdict ruled out.
ALTER TABLE builds ADD COLUMN IF NOT EXISTS needs_contract boolean;
ALTER TABLE builds ADD COLUMN IF NOT EXISTS needs_wallet boolean;
ALTER TABLE builds ADD COLUMN IF NOT EXISTS needs_reason text;
ALTER TABLE builds ADD COLUMN IF NOT EXISTS needs_source text;
ALTER TABLE builds ADD COLUMN IF NOT EXISTS needs_overridden boolean NOT NULL DEFAULT false;
GRANT ALL ON TABLE builds TO fletch;

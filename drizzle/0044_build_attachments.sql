-- Files a person attached to a brief: notes, a spec, a CSV of the data the app
-- should show. They are written into the workspace before the agent runs, so
-- the agent reads them as files rather than spending the prompt on them, and
-- kept on the build row so a restart writes the same ones again.
ALTER TABLE builds ADD COLUMN IF NOT EXISTS attachments jsonb;
GRANT ALL ON TABLE builds TO fletch;

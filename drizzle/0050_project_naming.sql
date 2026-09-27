-- Existing and user-chosen names stay under user control.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS name_source text NOT NULL DEFAULT 'legacy';

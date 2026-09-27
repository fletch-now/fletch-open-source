-- Additive only: ambiguous legacy builds intentionally retain a null selection.
ALTER TYPE build_provider ADD VALUE IF NOT EXISTS 'openai';
ALTER TABLE builds ADD COLUMN IF NOT EXISTS billing_mode text;
ALTER TABLE builds ADD COLUMN IF NOT EXISTS custody_mode text;
ALTER TABLE builds ADD COLUMN IF NOT EXISTS credential_id text;
ALTER TABLE builds ADD COLUMN IF NOT EXISTS credential_version integer;
ALTER TABLE builds ADD COLUMN IF NOT EXISTS capabilities jsonb;
ALTER TABLE user_model_keys ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE user_model_keys ADD COLUMN IF NOT EXISTS revoked_at timestamp;
ALTER TABLE user_model_keys ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'unvalidated';
ALTER TABLE user_model_keys ADD COLUMN IF NOT EXISTS validated_at timestamp;

CREATE OR REPLACE FUNCTION prevent_build_selection_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.billing_mode IS NOT NULL AND
    ROW(OLD.billing_mode, OLD.custody_mode, OLD.provider, OLD.model, OLD.credential_id, OLD.credential_version, OLD.capabilities)
    IS DISTINCT FROM
    ROW(NEW.billing_mode, NEW.custody_mode, NEW.provider, NEW.model, NEW.credential_id, NEW.credential_version, NEW.capabilities)
  THEN RAISE EXCEPTION 'Build execution selection is immutable'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS builds_immutable_selection ON builds;
CREATE TRIGGER builds_immutable_selection BEFORE UPDATE ON builds FOR EACH ROW EXECUTE FUNCTION prevent_build_selection_change();

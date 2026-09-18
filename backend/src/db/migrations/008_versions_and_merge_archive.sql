ALTER TABLE people ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
CREATE OR REPLACE FUNCTION bump_record_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN NEW.version := OLD.version + 1; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER people_version BEFORE UPDATE ON people FOR EACH ROW EXECUTE FUNCTION bump_record_version();
CREATE TRIGGER application_version BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION bump_record_version();
-- Full original records and application ownership are kept for reversible merges.
CREATE TABLE person_merge_archive (
  id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL, survivor_id INTEGER NOT NULL, snapshot JSONB NOT NULL,
  restored_at TIMESTAMPTZ
);

CREATE TABLE oauth_states(nonce UUID PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,provider TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL);

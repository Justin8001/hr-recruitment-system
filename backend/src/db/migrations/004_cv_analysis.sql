-- 004: CV analysis support (Wave 2).
-- Stores the provider's native message id so the CV attachment can be fetched
-- on demand at analysis time, plus whether an attachment exists and when the
-- application was last analyzed. The analysis result itself lives in the
-- existing `applications.ai` JSONB column.

ALTER TABLE applications ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS has_attachment BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMPTZ;

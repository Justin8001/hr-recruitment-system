-- 007: give every row imported from the workbook a stable identity.
--
-- The first import de-duplicated requests on title + client + request date.
-- That merged genuinely separate rows: the same client asking for two of the
-- same role on the same day is two headcounts, and in one case an OPEN request
-- disappeared because a filled one shared the key. 32 requests became 27.
--
-- The workbook has no id column, so identity comes from position: which sheet a
-- row came from and which row it was. That makes a re-import exact, and lets a
-- row created by the earlier (keyless) import be adopted instead of duplicated.

ALTER TABLE jobs         ADD COLUMN IF NOT EXISTS import_key TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS import_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_import_key
  ON jobs (import_key) WHERE import_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_import_key
  ON applications (import_key) WHERE import_key IS NOT NULL;

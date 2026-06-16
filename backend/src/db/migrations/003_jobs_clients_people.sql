-- 003: structural foundation (Wave 1).
-- Splits the flat `candidates` table into a normalized model:
--   people        — a unique person (the dedup unit)
--   clients       — client database ("who are they looking for")
--   jobs          — open positions, each with an auto running number
--   applications  — a person's application to (optionally) a job; this is the
--                   card that moves through the kanban board.
-- Existing `candidates` rows are migrated into people + applications, and the
-- old table is renamed to candidates_legacy (kept as a safety backup).

-- ---------- clients ----------
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  contact_name VARCHAR(200),
  contact_email VARCHAR(200),
  contact_phone VARCHAR(50),
  looking_for TEXT,                       -- what roles/profile the client seeks
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- jobs ----------
CREATE SEQUENCE IF NOT EXISTS jobs_number_seq START 1001;

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  job_number TEXT UNIQUE NOT NULL,        -- running number, assigned by the app
  title VARCHAR(200) NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  track VARCHAR(20),                      -- 'office' | 'multi' | 'project' | NULL
  status VARCHAR(20) NOT NULL DEFAULT 'open',  -- 'open' | 'closed'
  keywords TEXT,                          -- job-specific match keywords (Wave 2)
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

-- ---------- people ----------
CREATE TABLE IF NOT EXISTS people (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(200),
  phone VARCHAR(50),
  referral TEXT,                          -- "friend brings friend" / source of referral
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup helpers: one person per email (case-insensitive), index phone for lookup.
CREATE UNIQUE INDEX IF NOT EXISTS uq_people_email
  ON people (lower(email)) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS idx_people_phone
  ON people (phone) WHERE phone IS NOT NULL AND phone <> '';

-- ---------- applications ----------
CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'manual',  -- 'manual' | 'gmail' | 'outlook'
  ext_key TEXT UNIQUE,                    -- dedup key for scanned emails
  subject TEXT,
  snippet TEXT,
  email_date TIMESTAMPTZ,
  link TEXT,
  stage VARCHAR(30) NOT NULL DEFAULT 'new',
  role VARCHAR(200),                      -- free-text role (back-compat; use job_id going forward)
  rejection_reason TEXT,
  rejected_by VARCHAR(20),                -- 'us' | 'client' | NULL
  ai JSONB,
  notes TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applications_stage ON applications(stage);
CREATE INDEX IF NOT EXISTS idx_applications_person ON applications(person_id);
CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id);

-- ---------- migrate existing candidates ----------
-- Run only on the first application: when the old `candidates` table still
-- exists AND it hasn't already been migrated (no `candidates_legacy` yet).
-- This guard keeps the migration safe even if re-executed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'candidates')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'candidates_legacy') THEN

    -- 1) People: one row per distinct email (case-insensitive); rows without an
    --    email each become their own person.
    INSERT INTO people (name, email, created_at)
    SELECT DISTINCT ON (lower(c.email))
           c.name, c.email, c.added_at
    FROM candidates c
    WHERE c.email IS NOT NULL AND c.email <> ''
    ORDER BY lower(c.email), c.added_at ASC;

    INSERT INTO people (name, email, created_at)
    SELECT c.name, NULL, c.added_at
    FROM candidates c
    WHERE c.email IS NULL OR c.email = '';

    -- 2) Applications: link each legacy candidate to its person and copy the
    --    inbound/email metadata and pipeline state. job_id stays NULL.
    --    Emailed candidates match on email; email-less ones match on a synthetic
    --    key (name + added_at) which is unique enough for one-time migration.
    INSERT INTO applications
      (person_id, job_id, source, ext_key, subject, snippet, email_date, link,
       stage, role, ai, notes, added_at)
    SELECT
      p.id, NULL, c.source, c.ext_key, c.subject, c.snippet, c.email_date, c.link,
      c.stage, c.role, c.ai, c.notes, c.added_at
    FROM candidates c
    JOIN people p ON (
      (c.email IS NOT NULL AND c.email <> '' AND lower(p.email) = lower(c.email))
      OR ((c.email IS NULL OR c.email = '') AND p.email IS NULL
          AND p.name = c.name AND p.created_at = c.added_at)
    );

    -- 3) Keep the old table as a backup, but out of the way.
    ALTER TABLE candidates RENAME TO candidates_legacy;
  END IF;
END $$;

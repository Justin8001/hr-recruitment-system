-- 001: complete initial schema for the HR recruitment system.
-- This single migration bootstraps a fresh database entirely.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS candidates (
  id SERIAL PRIMARY KEY,
  ext_key TEXT UNIQUE,                 -- dedup key for scanned emails; NULL for manual entries
  source VARCHAR(20) NOT NULL DEFAULT 'manual',  -- 'manual' | 'gmail' | 'outlook'
  name VARCHAR(200) NOT NULL,
  email VARCHAR(200),
  subject TEXT,
  snippet TEXT,
  email_date TIMESTAMPTZ,
  link TEXT,
  stage VARCHAR(30) NOT NULL DEFAULT 'new',
  role VARCHAR(200),
  notes TEXT,
  ai JSONB,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidates_stage ON candidates(stage);

-- Single-row settings table (id is forced to 1).
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL,
  CONSTRAINT app_settings_singleton CHECK (id = 1)
);

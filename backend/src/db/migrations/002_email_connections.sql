-- 002: per-user OAuth connections to email providers (Gmail / Microsoft).
-- Tokens are stored encrypted (AES-256-GCM) by the application layer.

CREATE TABLE IF NOT EXISTS email_connections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL,          -- 'google' | 'microsoft'
  account_email VARCHAR(200),
  refresh_token_enc TEXT NOT NULL,
  access_token_enc TEXT,
  expires_at TIMESTAMPTZ,
  scopes TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

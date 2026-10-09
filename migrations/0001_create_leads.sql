-- Contact form submissions.
CREATE TABLE IF NOT EXISTS leads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  name        TEXT    NOT NULL,
  email       TEXT    NOT NULL,
  company     TEXT,
  service     TEXT    NOT NULL,
  budget      TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  source_page TEXT,
  -- Salted SHA-256 of the visitor IP: lets us rate-limit without storing the raw IP.
  ip_hash     TEXT    NOT NULL,
  country     TEXT,
  emailed     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_leads_ip_time ON leads (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at);

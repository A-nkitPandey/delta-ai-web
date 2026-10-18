-- WhatsApp chats answered by the AI assistant (/api/whatsapp).
-- Used to skip duplicate deliveries and to remember the last few turns.
-- The webhook also creates this table on first use and deletes rows older than 30 days.
CREATE TABLE IF NOT EXISTS wa_messages (
  id          TEXT    PRIMARY KEY,   -- WhatsApp message id (wamid…), or out-<uuid> for our replies
  wa_from     TEXT    NOT NULL,      -- customer's WhatsApp number
  direction   TEXT    NOT NULL,      -- 'in' or 'out'
  body        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL       -- unix seconds
);

CREATE INDEX IF NOT EXISTS idx_wa_from_time ON wa_messages (wa_from, created_at);

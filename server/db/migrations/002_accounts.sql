-- Player accounts and persistent HTTP sessions.

CREATE TABLE accounts (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- login name, unique regardless of case
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,                        -- bcrypt hash, never sent anywhere
  role          TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'moderator', 'admin')),
  locale        TEXT NOT NULL DEFAULT 'en',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login    TEXT,
  banned_until  TEXT,                                 -- NULL = not banned; '9999-12-31 ...' = permanent
  ban_reason    TEXT
);
CREATE INDEX idx_accounts_role ON accounts(role);

-- express-session storage. `expires` is a Unix timestamp in milliseconds.
CREATE TABLE sessions (
  sid     TEXT PRIMARY KEY,
  sess    TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires);

-- Administration: chat mutes, and the logs read by the administration panel
-- (connections, administrator actions, shop sales, rare drops). Trades are
-- logged in trade_log since migration 011.

ALTER TABLE accounts ADD COLUMN muted_until TEXT;
ALTER TABLE accounts ADD COLUMN mute_reason TEXT;

CREATE TABLE connection_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id   INTEGER NOT NULL,
  character_id INTEGER,
  event        TEXT NOT NULL CHECK (event IN ('login', 'logout')),
  ip           TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX connection_log_account ON connection_log (account_id, id);

CREATE TABLE admin_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   INTEGER NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  details    TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX admin_log_admin ON admin_log (admin_id, id);

CREATE TABLE sale_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('buy', 'sell')),
  item_kind    TEXT NOT NULL,
  item_id      INTEGER NOT NULL,
  quantity     INTEGER NOT NULL,
  price        INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX sale_log_character ON sale_log (character_id, id);

CREATE TABLE drop_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  enemy_id     INTEGER NOT NULL,
  item_kind    TEXT NOT NULL,
  item_id      INTEGER NOT NULL,
  chance       REAL NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX drop_log_character ON drop_log (character_id, id);

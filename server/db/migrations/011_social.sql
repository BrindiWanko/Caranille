-- Social: friend lists, ignore lists and the log of completed trades.

CREATE TABLE character_friends (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  friend_id    INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (character_id, friend_id)
);

CREATE TABLE character_ignores (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  ignored_id   INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  PRIMARY KEY (character_id, ignored_id)
);

-- One row per completed trade; items as JSON arrays of { kind, id, quantity }.
CREATE TABLE trade_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  a_id       INTEGER NOT NULL,
  b_id       INTEGER NOT NULL,
  a_items    TEXT NOT NULL,
  b_items    TEXT NOT NULL,
  a_gold     INTEGER NOT NULL,
  b_gold     INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX trade_log_a ON trade_log (a_id);
CREATE INDEX trade_log_b ON trade_log (b_id);

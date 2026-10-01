-- Player reports ("Report" in the menu of a player), read in the
-- administration panel logs. Names are kept so a report survives the deletion
-- of the characters.

CREATE TABLE report_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id   INTEGER,
  reporter_name TEXT NOT NULL,
  target_id     INTEGER,
  target_name   TEXT NOT NULL,
  reason        TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX report_log_target ON report_log (target_id, id);

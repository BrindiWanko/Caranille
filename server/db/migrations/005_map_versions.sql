-- Version history of maps: a snapshot is stored at every save from the editor,
-- so any earlier state can be restored. Old snapshots are pruned per map.

CREATE TABLE map_versions (
  id         INTEGER PRIMARY KEY,
  map_id     INTEGER NOT NULL,
  data       TEXT NOT NULL,          -- full map JSON at that time
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_map_versions_map ON map_versions(map_id, id);

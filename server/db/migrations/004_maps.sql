-- Maps authored in the editor. The map tree (parent/order) and the full map
-- content (cells, events, properties) are stored together; `data` is JSON.

CREATE TABLE maps (
  id         INTEGER PRIMARY KEY,
  parent_id  INTEGER NOT NULL DEFAULT 0,  -- 0 = root of the tree
  name       TEXT NOT NULL,               -- editor name (the in-game name is data.displayName)
  sort_order INTEGER NOT NULL DEFAULT 0,
  expanded   INTEGER NOT NULL DEFAULT 1,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_maps_parent ON maps(parent_id, sort_order);

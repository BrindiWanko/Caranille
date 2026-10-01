-- Editor database content and player characters.

-- Content authored in the editor's database tabs (classes, tilesets, items, skills...).
-- One row per entry; `data` is the full JSON record validated by the shared types.
CREATE TABLE game_data (
  type       TEXT NOT NULL,              -- 'class', 'tileset', 'item', 'skill', ...
  id         INTEGER NOT NULL,           -- identifier within the type, starting at 1
  name       TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (type, id)
);

CREATE TABLE characters (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  class_id    INTEGER NOT NULL,
  appearance  TEXT NOT NULL,             -- JSON, see shared/art/character.ts
  level       INTEGER NOT NULL DEFAULT 1,
  xp          INTEGER NOT NULL DEFAULT 0,
  hp          INTEGER NOT NULL,
  mp          INTEGER NOT NULL,
  gold        INTEGER NOT NULL DEFAULT 0,
  map_id      INTEGER NOT NULL,
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  direction   INTEGER NOT NULL DEFAULT 2, -- 2 down, 4 left, 6 right, 8 up
  play_time   INTEGER NOT NULL DEFAULT 0, -- seconds
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_played TEXT
);
CREATE INDEX idx_characters_account ON characters(account_id);
CREATE INDEX idx_characters_map ON characters(map_id);

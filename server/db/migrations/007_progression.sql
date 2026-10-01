-- Story progress: personal switches / variables / self switches / quests of each
-- character, global (server-wide) switches and variables, and equipment.
-- Only non-default values are stored (a switch that is OFF or a variable at 0 has no row).

CREATE TABLE character_switches (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  switch_id    INTEGER NOT NULL,
  PRIMARY KEY (character_id, switch_id)
);

CREATE TABLE character_variables (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  variable_id  INTEGER NOT NULL,
  value        INTEGER NOT NULL,
  PRIMARY KEY (character_id, variable_id)
);

-- Self switches belong to one event of one map, for one character
-- (a chest opened by me stays closed for the others).
CREATE TABLE character_self_switches (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  map_id       INTEGER NOT NULL,
  event_id     INTEGER NOT NULL,
  letter       TEXT NOT NULL CHECK (letter IN ('A', 'B', 'C', 'D')),
  PRIMARY KEY (character_id, map_id, event_id, letter)
);

CREATE TABLE character_quests (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  quest_id     INTEGER NOT NULL,
  status       INTEGER NOT NULL CHECK (status IN (1, 2)), -- 1 in progress, 2 completed
  step         INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (character_id, quest_id)
);

CREATE TABLE global_switches (
  switch_id INTEGER PRIMARY KEY
);

CREATE TABLE global_variables (
  variable_id INTEGER PRIMARY KEY,
  value       INTEGER NOT NULL
);

-- Equipped weapon / armors (one row per occupied slot); an equipped item leaves the bag.
CREATE TABLE character_equipment (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot         TEXT NOT NULL,
  item_kind    TEXT NOT NULL CHECK (item_kind IN ('weapon', 'armor')),
  item_id      INTEGER NOT NULL,
  PRIMARY KEY (character_id, slot)
);

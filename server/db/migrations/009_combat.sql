-- Combat: the hotbar of each character (JSON array of { kind, id } or null)
-- and its respawn point (0 = the start position of the System settings).
ALTER TABLE characters ADD COLUMN hotbar TEXT NOT NULL DEFAULT '[]';
ALTER TABLE characters ADD COLUMN respawn_map INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN respawn_x INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN respawn_y INTEGER NOT NULL DEFAULT 0;

-- Raid lockouts: a character receives the rewards of a raid once per period.
CREATE TABLE character_raid_lockouts (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  raid_id      INTEGER NOT NULL,
  until        INTEGER NOT NULL, -- epoch milliseconds
  PRIMARY KEY (character_id, raid_id)
);

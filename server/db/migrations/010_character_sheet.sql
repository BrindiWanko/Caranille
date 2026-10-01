-- Character sheet: parameter points distributed by the player (JSON object
-- { param: points }), and the personal bank (gold and items).
ALTER TABLE characters ADD COLUMN allocated TEXT NOT NULL DEFAULT '{}';
ALTER TABLE characters ADD COLUMN bank_gold INTEGER NOT NULL DEFAULT 0;

CREATE TABLE character_bank (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_kind    TEXT NOT NULL CHECK (item_kind IN ('item', 'weapon', 'armor')),
  item_id      INTEGER NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (character_id, item_kind, item_id)
);

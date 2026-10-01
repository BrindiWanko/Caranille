-- Character inventories: one row per owned item, weapon or armor, with its quantity.

CREATE TABLE character_items (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_kind    TEXT NOT NULL CHECK (item_kind IN ('item', 'weapon', 'armor')),
  item_id      INTEGER NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (character_id, item_kind, item_id)
);

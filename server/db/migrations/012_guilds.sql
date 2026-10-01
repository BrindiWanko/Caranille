-- Guilds: identity (name, tag, emblem), message of the day, level and
-- experience, bank gold; ranks with permissions; members; bank items; log.

CREATE TABLE guilds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tag        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  emblem     TEXT NOT NULL,
  motd       TEXT NOT NULL DEFAULT '',
  level      INTEGER NOT NULL DEFAULT 1,
  xp         INTEGER NOT NULL DEFAULT 0,
  gold       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Rank 0 is the leader; higher numbers are lower ranks.
CREATE TABLE guild_ranks (
  guild_id    INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  rank        INTEGER NOT NULL,
  name        TEXT NOT NULL,
  permissions INTEGER NOT NULL,
  PRIMARY KEY (guild_id, rank)
);

CREATE TABLE guild_members (
  character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  guild_id     INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  rank         INTEGER NOT NULL,
  joined_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX guild_members_guild ON guild_members (guild_id);

CREATE TABLE guild_bank_items (
  guild_id  INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('item', 'weapon', 'armor')),
  item_id   INTEGER NOT NULL,
  quantity  INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (guild_id, item_kind, item_id)
);

CREATE TABLE guild_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  character_id INTEGER,
  action       TEXT NOT NULL,
  details      TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX guild_log_guild ON guild_log (guild_id, id);

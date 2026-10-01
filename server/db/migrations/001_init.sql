-- Base tables: system settings, server secrets and the resource manifest.

-- Key/value store for engine-wide settings edited from the admin panel
-- (game title, start position, currency name...). Values are JSON.
CREATE TABLE system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Secrets generated at first boot (e.g. session signing key). Never sent to clients.
CREATE TABLE server_secrets (
  name  TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Manifest of every graphic/audio resource. Files live on disk; only metadata is stored here.
CREATE TABLE resources (
  id         TEXT PRIMARY KEY,                  -- stable identifier, e.g. 'tilesets/Outside_A2'
  kind       TEXT NOT NULL,                     -- tilesets, characters, faces, enemies, animations, system, parallaxes, pictures, bgm, bgs, me, se
  name       TEXT NOT NULL,                     -- file name without extension
  path       TEXT NOT NULL,                     -- path relative to the project root
  format     TEXT NOT NULL DEFAULT '',          -- detected sheet format, e.g. 'standard-tileset-a2'
  mime       TEXT NOT NULL,
  width      INTEGER,
  height     INTEGER,
  hash       TEXT NOT NULL DEFAULT '',
  origin     TEXT NOT NULL DEFAULT 'generated', -- generated, uploaded or imported
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_resources_kind ON resources(kind);

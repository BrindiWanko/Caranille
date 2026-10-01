/**
 * @file Starter data for a brand-new database.
 *
 * Runs at every startup but only fills what is missing, so it is idempotent and
 * never overwrites content edited in the admin panel: system settings, the
 * default classes, skills, items, equipment, enemies, states and quests, the default tilesets (sheet names and flags produced by
 * the graphics generator in `assets/data/tilesets.json`) and the starting village.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TilesetData } from '../../shared/database.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import { PATHS } from '../paths.js';
import type { Db } from './database.js';
import { DEMO_MAPS, buildDemoDungeon, buildDemoForest, buildDemoHouse, buildDemoVillage } from './demo-map.js';
import { GameDataRepository } from './game-data.js';
import { MapRepository } from './maps.js';
import { DEFAULT_ARMORS, DEFAULT_CLASSES, DEFAULT_ENEMIES, DEFAULT_ITEMS, DEFAULT_QUESTS, DEFAULT_RAIDS, DEFAULT_SKILLS, DEFAULT_STATES, DEFAULT_WEAPONS } from './seed-data.js';
import { SettingsRepository } from './settings.js';

/** Reads the default tilesets written by `npm run assets:build`. */
function defaultTilesets(): TilesetData[] {
  const file = join(PATHS.assets, 'data', 'tilesets.json');
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, 'utf8')) as { tilesets: TilesetData[] }).tilesets;
}

/**
 * Inserts default data that is not present yet.
 * @param db - Migrated connection.
 */
export function seed(db: Db): void {
  const settings = new SettingsRepository(db);
  const data = new GameDataRepository(db);
  const maps = new MapRepository(db);
  db.transaction(() => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (!settings.has(key)) settings.set(key, value);
    }
    if (data.count('class') === 0) for (const c of DEFAULT_CLASSES) data.save('class', c);
    if (data.count('skill') === 0) for (const r of DEFAULT_SKILLS) data.save('skill', r);
    if (data.count('item') === 0) for (const r of DEFAULT_ITEMS) data.save('item', r);
    if (data.count('weapon') === 0) for (const r of DEFAULT_WEAPONS) data.save('weapon', r);
    if (data.count('armor') === 0) for (const r of DEFAULT_ARMORS) data.save('armor', r);
    if (data.count('enemy') === 0) for (const r of DEFAULT_ENEMIES) data.save('enemy', r);
    if (data.count('state') === 0) for (const r of DEFAULT_STATES) data.save('state', r);
    if (data.count('quest') === 0) for (const r of DEFAULT_QUESTS) data.save('quest', r);
    if (data.count('tileset') === 0) for (const t of defaultTilesets()) data.save('tileset', t);
    if (maps.count() === 0) {
      maps.save({ id: DEMO_MAPS.village, parentId: 0, name: 'Village', order: 1, expanded: true }, buildDemoVillage());
      maps.save({ id: DEMO_MAPS.forest, parentId: 0, name: 'Forêt', order: 2, expanded: true }, buildDemoForest());
      maps.save({ id: DEMO_MAPS.house, parentId: DEMO_MAPS.village, name: 'Maison de Tomas', order: 1, expanded: true }, buildDemoHouse());
      maps.save({ id: DEMO_MAPS.dungeon, parentId: DEMO_MAPS.forest, name: 'Grotte (donjon)', order: 1, expanded: true }, buildDemoDungeon());
    }
    // A raid needs its map and its boss: on a database created before raids
    // existed, the demo cave and its king are absent, so the demo raid is skipped.
    if (data.count('raid') === 0) {
      for (const r of DEFAULT_RAIDS) if (maps.get(r.mapId) && data.get('enemy', r.bossEnemyId)) data.save('raid', r);
    }
  })();
}

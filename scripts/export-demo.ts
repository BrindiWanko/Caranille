/**
 * @file Exports the demonstration game (the content of a brand-new database:
 * village, forest, house, instanced cave with its raid boss, the chapter 1
 * quest chain and the whole game database) to JSON files in `demo/`:
 *
 * - `demo/data/MapInfos.json` and `demo/data/MapXXX.json`: the maps in the
 *   standard map file layout (with the engine's `mmo` block), importable with
 *   the editor's "Import a project" button (zip the `data` folder);
 * - `demo/database.json`: classes, skills, items, equipment, enemies, states,
 *   animations, common events, quests, raids and the System settings, in the
 *   format of the database window's JSON export / import.
 *
 * Usage: `npm run demo:export`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATABASE_TYPES } from '../shared/database.js';
import { DATABASE_EXPORT_VERSION, readSystem } from '../server/admin/database-routes.js';
import { config } from '../server/config.js';
import { closeContext, createContext } from '../server/context.js';
import { exportMap } from '../server/importers/project.js';
import { ROOT_DIR } from '../server/paths.js';

const ctx = createContext({ ...config, dbPath: ':memory:', sessionSecret: 'demo-export' }, { bcryptRounds: 4 });
const out = join(ROOT_DIR, 'demo');
const data = join(out, 'data');
mkdirSync(data, { recursive: true });

const infos = ctx.maps.infos();
// Standard MapInfos layout: index = map id, null for unused ids.
const mapInfos: unknown[] = [null];
for (const info of infos) {
  mapInfos[info.id] = { id: info.id, name: info.name, parentId: info.parentId, order: info.order, expanded: info.expanded, scrollX: 0, scrollY: 0 };
  const map = ctx.maps.get(info.id);
  if (map) writeFileSync(join(data, `Map${String(info.id).padStart(3, '0')}.json`), JSON.stringify(exportMap(map)));
}
for (let i = 0; i < mapInfos.length; i++) mapInfos[i] ??= null;
writeFileSync(join(data, 'MapInfos.json'), JSON.stringify(mapInfos, null, 1));

const database = Object.fromEntries(DATABASE_TYPES.map((t) => [t, ctx.gameData.list(t)]));
writeFileSync(join(out, 'database.json'), JSON.stringify({ version: DATABASE_EXPORT_VERSION, database, system: readSystem(ctx) }, null, 1));

console.log(`[demo] ${infos.length} maps and ${DATABASE_TYPES.length} database tables exported to ${out}`);
closeContext(ctx);
process.exit(0);

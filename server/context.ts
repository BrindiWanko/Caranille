/**
 * @file The server context: the set of long-lived services (database connection,
 * repositories, configuration) shared by HTTP routes, socket handlers and the
 * game loop. It is created once in `index.ts` and passed explicitly, which keeps
 * modules free of hidden global state and lets tests build an isolated context
 * on an in-memory database.
 */
import type { RequestHandler } from 'express';
import { EditLocks } from './admin/edit-locks.js';
import { AuthService } from './auth/service.js';
import type { Config } from './config.js';
import { AccountRepository } from './db/accounts.js';
import { CharacterRepository } from './db/characters.js';
import type { Db } from './db/database.js';
import { openDatabase } from './db/database.js';
import { GameDataRepository } from './db/game-data.js';
import { InventoryRepository } from './db/inventory.js';
import { MapRepository } from './db/maps.js';
import { ResourceRepository } from './db/resources.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { ProgressionRepository } from './db/progression.js';
import { SocialRepository } from './db/social.js';
import { GuildRepository } from './db/guilds.js';
import { AdminRepository } from './db/admin.js';
import { SqliteSessionStore } from './db/session-store.js';
import { SettingsRepository } from './db/settings.js';
import { CharacterService } from './game/character-service.js';
import { InventoryService } from './game/inventory-service.js';
import { World } from './game/world.js';
import { DEFAULT_SETTINGS } from '../shared/settings.js';
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { RESTORE_FILE } from './admin/admin-routes.js';
import { createSessionMiddleware } from './http/session.js';
import { PATHS } from './paths.js';
import { scanResources } from './resources/scanner.js';

/** Services available to every part of the server. */
export interface ServerContext {
  config: Config;
  db: Db;
  settings: SettingsRepository;
  accounts: AccountRepository;
  auth: AuthService;
  resources: ResourceRepository;
  gameData: GameDataRepository;
  characters: CharacterRepository;
  characterService: CharacterService;
  maps: MapRepository;
  inventory: InventoryRepository;
  inventoryService: InventoryService;
  /** Story progress (switches, variables, self switches, quests) and equipment. */
  progression: ProgressionRepository;
  /** Friend and ignore lists, trades. */
  social: SocialRepository;
  /** Guilds, their ranks, bank and log. */
  guilds: GuildRepository;
  /** Sanctions and logs of the administration panel. */
  admin: AdminRepository;
  /** Editor locks (one administrator per map). */
  editLocks: EditLocks;
  /** Live world (loaded maps, connected players). */
  world: World;
  sessionStore: SqliteSessionStore;
  /** Session middleware shared by Express and socket.io. */
  sessionMiddleware: RequestHandler;
}

/** Options mainly useful for tests. */
export interface ContextOptions {
  /** Password hashing cost (default 11). */
  bcryptRounds?: number;
}

/**
 * Replaces the database with a backup uploaded from the administration panel,
 * if one is waiting (the current file is kept next to it as `.before-restore`).
 */
function applyPendingRestore(dbPath: string): void {
  if (dbPath === ':memory:') return;
  const pending = join(PATHS.data, RESTORE_FILE);
  if (!existsSync(pending)) return;
  for (const suffix of ['-wal', '-shm']) if (existsSync(dbPath + suffix)) renameSync(dbPath + suffix, `${dbPath}.before-restore${suffix}`);
  if (existsSync(dbPath)) renameSync(dbPath, `${dbPath}.before-restore`);
  renameSync(pending, dbPath);
  console.log('[caranille] database restored from an uploaded backup');
}

/**
 * Opens the database, applies migrations and seed data, and builds the context.
 * @param config - Server configuration (the database path is taken from it).
 * @param options - Optional overrides.
 * @returns A fully initialised context.
 */
export function createContext(config: Config, options: ContextOptions = {}): ServerContext {
  applyPendingRestore(config.dbPath);
  const db = openDatabase(config.dbPath);
  migrate(db, PATHS.migrations);
  seed(db);
  const settings = new SettingsRepository(db);
  const accounts = new AccountRepository(db);
  const sessionStore = new SqliteSessionStore(db);
  const resources = new ResourceRepository(db);
  // Register every graphic/sound present on disk (generated, uploaded or imported).
  resources.sync(scanResources());
  const gameData = new GameDataRepository(db);
  const characters = new CharacterRepository(db);
  const inventory = new InventoryRepository(db);
  const secret = config.sessionSecret ?? settings.secret('session');
  const ctx: ServerContext = {
    config,
    db,
    settings,
    accounts,
    auth: new AuthService(accounts, options.bcryptRounds ?? 11),
    resources,
    gameData,
    characters,
    characterService: new CharacterService(characters, gameData, settings, config.maxCharactersPerAccount),
    maps: new MapRepository(db),
    inventory,
    inventoryService: new InventoryService(inventory, gameData, () => settings.get('bagSize', DEFAULT_SETTINGS.bagSize)),
    progression: new ProgressionRepository(db),
    social: new SocialRepository(db),
    guilds: new GuildRepository(db),
    admin: new AdminRepository(db),
    editLocks: new EditLocks(),
    // Assigned right below: the world needs the finished context.
    world: undefined as unknown as World,
    sessionStore,
    sessionMiddleware: createSessionMiddleware(config, sessionStore, secret),
  };
  ctx.world = new World(ctx);
  return ctx;
}

/**
 * Releases the resources held by a context (timers, database handle).
 * @param ctx - Context to close.
 */
export function closeContext(ctx: ServerContext): void {
  ctx.world.close();
  ctx.sessionStore.close();
  ctx.db.close();
}

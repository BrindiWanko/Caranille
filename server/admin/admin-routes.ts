/**
 * @file JSON API of the administration panel (mounted under `/api/admin`).
 *
 * Moderators may read the dashboard, the accounts and the logs, kick players,
 * mute them and ban them for up to 7 days. Administrators may also change
 * roles, ban for longer or for good, reset passwords, use the game tools
 * (teleport, invisibility, give items and gold, change switches and
 * variables, announcements) and download or restore database backups.
 * Every action is checked here and written to the administrator log.
 * Writes need the `X-CSRF-Token` header.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import express, { Router, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';
import type { AccountRole } from '../../shared/protocol.js';
import { hasRole, isRole } from '../../shared/roles.js';
import { currentAccount, requireRoleApi } from '../auth/middleware.js';
import type { ServerContext } from '../context.js';
import { LOG_TYPES, PERMANENT, sqlDate, type LogType } from '../db/admin.js';
import { verifyCsrfHeader } from '../http/csrf.js';
import { PATHS } from '../paths.js';

/** Longest ban a moderator may give. */
const MODERATOR_MAX_BAN_MINUTES = 7 * 24 * 60;
/** Name of a backup waiting to replace the database at the next start. */
export const RESTORE_FILE = 'restore-pending.db';

const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function fail(res: Response, status: number, error: string, params?: Record<string, string | number>): void {
  res.status(status).json({ error, params });
}

/** Measures the event loop lag (how late timers fire), in milliseconds. */
function lagMonitor(): () => number {
  let lag = 0;
  let expected = Date.now() + 500;
  const timer = setInterval(() => {
    const now = Date.now();
    lag = lag * 0.8 + Math.max(0, now - expected) * 0.2;
    expected = now + 500;
  }, 500);
  timer.unref();
  return () => Math.round(lag);
}

/**
 * Creates the administration API router.
 * @param ctx - Server context.
 */
export function adminRouter(ctx: ServerContext): Router {
  const router = Router();
  router.use(requireRoleApi('moderator'));
  router.use(express.json({ limit: '1mb' }));
  router.use(verifyCsrfHeader);
  const me = (res: Response) => currentAccount(res)!;
  const isAdmin = (res: Response) => hasRole(me(res).role, 'admin');
  const adminOnly = (req: Request, res: Response, next: () => void) => (isAdmin(res) ? next() : fail(res, 403, 'error.http.forbidden'));
  const log = (res: Response, action: string, target: string, details: Record<string, unknown> = {}) => ctx.admin.logAdmin(me(res).id, action, target, details);
  const world = ctx.world;
  const lag = lagMonitor();
  let lastCpu = process.cpuUsage();
  let lastCpuAt = Date.now();

  // --- Dashboard -----------------------------------------------------------------

  router.get('/dashboard', (_req, res) => {
    const cpu = process.cpuUsage(lastCpu);
    const elapsed = Math.max(1, Date.now() - lastCpuAt) * 1000;
    lastCpu = process.cpuUsage();
    lastCpuAt = Date.now();
    const players = [...world.allPlayers()].filter((p) => world.isLive(p));
    const maps = new Map<string, { mapId: number; instance: number; name: string; players: number }>();
    for (const p of players) {
      const key = `${p.mapId}:${p.instance}`;
      const entry = maps.get(key) ?? { mapId: p.mapId, instance: p.instance, name: world.mapRuntime(p.mapId)?.map.displayName ?? '?', players: 0 };
      entry.players++;
      maps.set(key, entry);
    }
    const memory = process.memoryUsage();
    res.json({
      players: players.map((p) => ({ id: p.characterId, accountId: p.accountId, name: p.name, level: p.level, mapId: p.mapId, instance: p.instance, x: p.x, y: p.y, invisible: p.invisible === true })),
      maps: [...maps.values()],
      instances: world.instances.list().map((i) => ({ id: i.id, mapId: i.mapId, owner: i.owner, players: world.instances.players(i).length, bossDefeated: i.bossDefeated })),
      server: {
        uptime: Math.round(process.uptime()),
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        cpu: Math.round(((cpu.user + cpu.system) / elapsed) * 100),
        lag: lag(),
        load: os.loadavg()[0],
        node: process.version,
        accounts: ctx.accounts.count(),
      },
    });
  });

  // --- Accounts -----------------------------------------------------------------------

  router.get('/accounts', (req, res) => {
    res.json({ accounts: ctx.admin.searchAccounts(text(req.query.q, 60)) });
  });

  router.get('/accounts/:id', (req, res) => {
    const id = Number(req.params.id);
    const account = ctx.admin.account(id);
    if (!account) return fail(res, 404, 'error.admin.not_found');
    const characters = ctx.characters.listByAccount(id).map((c) => ({ id: c.id, name: c.name, level: c.level, mapId: c.mapId, x: c.x, y: c.y, gold: c.gold, online: !!world.player(c.id) }));
    const logs = Object.fromEntries(LOG_TYPES.map((t) => [t, ctx.admin.logs(t, id, 50)]));
    res.json({ account, characters, logs });
  });

  router.post('/accounts/:id/role', adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const role = (req.body as { role?: unknown }).role;
    if (!isRole(role) || !ctx.admin.account(id)) return fail(res, 400, 'error.admin.invalid');
    if (id === me(res).id) return fail(res, 400, 'error.admin.self');
    ctx.admin.setRole(id, role as AccountRole);
    world.setAccountRole(id, role as AccountRole);
    log(res, 'role', `account:${id}`, { role });
    res.json({ ok: true });
  });

  router.post('/accounts/:id/ban', (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as { minutes?: unknown; permanent?: unknown; reason?: unknown };
    const target = ctx.admin.account(id);
    if (!target) return fail(res, 404, 'error.admin.not_found');
    if (id === me(res).id || hasRole(target.role, me(res).role)) return fail(res, 403, 'error.admin.rank');
    const permanent = body.permanent === true;
    if (!permanent && !isInt(body.minutes, 1, 5_256_000)) return fail(res, 400, 'error.admin.invalid');
    if (!isAdmin(res) && (permanent || (body.minutes as number) > MODERATOR_MAX_BAN_MINUTES)) return fail(res, 403, 'error.admin.ban_too_long');
    const until = permanent ? PERMANENT : sqlDate(Date.now() + (body.minutes as number) * 60_000);
    const reason = text(body.reason, 200);
    ctx.admin.setBan(id, until, reason || null);
    world.kickAccount(id, 'error.auth.banned');
    log(res, 'ban', `account:${id}`, { until, reason });
    res.json({ ok: true, until });
  });

  router.post('/accounts/:id/unban', (req, res) => {
    const id = Number(req.params.id);
    const target = ctx.admin.account(id);
    if (!target) return fail(res, 404, 'error.admin.not_found');
    if (hasRole(target.role, me(res).role)) return fail(res, 403, 'error.admin.rank');
    // A moderator may only lift what a moderator could have given (not a permanent or longer ban).
    if (!isAdmin(res) && target.bannedUntil !== null && target.bannedUntil > sqlDate(Date.now() + MODERATOR_MAX_BAN_MINUTES * 60_000)) {
      return fail(res, 403, 'error.admin.ban_too_long');
    }
    ctx.admin.setBan(id, null, null);
    log(res, 'unban', `account:${id}`);
    res.json({ ok: true });
  });

  router.post('/accounts/:id/mute', (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as { minutes?: unknown; reason?: unknown };
    const target = ctx.admin.account(id);
    if (!target) return fail(res, 404, 'error.admin.not_found');
    if (id === me(res).id || hasRole(target.role, me(res).role)) return fail(res, 403, 'error.admin.rank');
    if (!isInt(body.minutes, 1, 525_600)) return fail(res, 400, 'error.admin.invalid');
    const until = sqlDate(Date.now() + body.minutes * 60_000);
    const reason = text(body.reason, 200);
    ctx.admin.setMute(id, until, reason || null);
    for (const p of world.allPlayers()) if (p.accountId === id) p.socket.emit('notify', { key: 'notify.muted', params: { until } });
    log(res, 'mute', `account:${id}`, { until, reason });
    res.json({ ok: true, until });
  });

  router.post('/accounts/:id/unmute', (req, res) => {
    const id = Number(req.params.id);
    const target = ctx.admin.account(id);
    if (!target) return fail(res, 404, 'error.admin.not_found');
    if (hasRole(target.role, me(res).role)) return fail(res, 403, 'error.admin.rank');
    ctx.admin.setMute(id, null, null);
    log(res, 'unmute', `account:${id}`);
    res.json({ ok: true });
  });

  router.post('/accounts/:id/kick', (req, res) => {
    const id = Number(req.params.id);
    const target = ctx.admin.account(id);
    if (!target) return fail(res, 404, 'error.admin.not_found');
    if (hasRole(target.role, me(res).role) && id !== me(res).id) return fail(res, 403, 'error.admin.rank');
    world.kickAccount(id, 'error.net.kicked');
    log(res, 'kick', `account:${id}`);
    res.json({ ok: true });
  });

  /** Gives the account a new random password, shown once to the administrator. */
  router.post('/accounts/:id/reset-password', adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    if (!ctx.admin.account(id)) return fail(res, 404, 'error.admin.not_found');
    const password = randomBytes(9).toString('base64url');
    ctx.admin.setPasswordHash(id, await bcrypt.hash(password, ctx.config.production ? 11 : 4));
    // Whoever knew the old password is logged out of the site too (the caller keeps its own session).
    ctx.sessionStore.destroyAccountSessions(id, id === me(res).id ? req.sessionID : '');
    world.kickAccount(id, 'error.net.kicked');
    log(res, 'reset_password', `account:${id}`);
    res.json({ ok: true, password });
  });

  /** Sends a character (offline or online) back to the start position. */
  router.post('/characters/:id/reset-position', (req, res) => {
    const id = Number(req.params.id);
    const character = ctx.characters.findById(id);
    if (!character) return fail(res, 404, 'error.admin.not_found');
    const start = world.startPosition();
    const online = world.player(id);
    if (online) world.transfer(online, start.mapId, start.x, start.y, start.direction);
    else ctx.characters.saveStates([[id, { mapId: start.mapId, x: start.x, y: start.y, direction: start.direction, hp: character.hp, mp: character.mp, playTimeDelta: 0 }]]);
    log(res, 'reset_position', `character:${id}`);
    res.json({ ok: true });
  });

  // --- Game tools (administrators) ------------------------------------------------------

  const online = (res: Response, id: unknown) => {
    const p = isInt(id, 1, Number.MAX_SAFE_INTEGER) ? world.player(id) : undefined;
    if (!p || !world.isLive(p)) fail(res, 404, 'error.admin.offline');
    return p && world.isLive(p) ? p : undefined;
  };
  /** The administrator's own character in game. */
  const self = (res: Response) => [...world.allPlayers()].find((p) => p.accountId === me(res).id && world.isLive(p));

  router.post('/tools/teleport', adminOnly, (req, res) => {
    const body = req.body as { characterId?: unknown; mapId?: unknown; x?: unknown; y?: unknown; toCharacterId?: unknown };
    const target = body.characterId === 'self' ? self(res) : online(res, body.characterId);
    if (!target) {
      if (!res.headersSent) fail(res, 404, 'error.admin.offline');
      return;
    }
    let dest: { mapId: number; x: number; y: number } | undefined;
    if (body.toCharacterId !== undefined) {
      const to = body.toCharacterId === 'self' ? self(res) : online(res, body.toCharacterId);
      if (!to) {
        if (!res.headersSent) fail(res, 404, 'error.admin.offline');
        return;
      }
      dest = { mapId: to.mapId, x: to.x, y: to.y };
    } else if (isInt(body.mapId, 1, 1_000_000) && isInt(body.x, 0, 255) && isInt(body.y, 0, 255)) {
      dest = { mapId: body.mapId, x: body.x, y: body.y };
    }
    if (!dest || !world.transfer(target, dest.mapId, dest.x, dest.y, 2)) return fail(res, 400, 'error.admin.invalid');
    log(res, 'teleport', `character:${target.characterId}`, dest);
    res.json({ ok: true });
  });

  router.post('/tools/invisible', adminOnly, (req, res) => {
    const p = self(res);
    if (!p) return fail(res, 404, 'error.admin.offline');
    world.setInvisible(p, (req.body as { on?: unknown }).on === true);
    log(res, 'invisible', `character:${p.characterId}`, { on: p.invisible });
    res.json({ ok: true, invisible: p.invisible });
  });

  router.post('/tools/give', adminOnly, (req, res) => {
    const body = req.body as { characterId?: unknown; kind?: unknown; id?: unknown; quantity?: unknown; gold?: unknown };
    const p = online(res, body.characterId);
    if (!p) return;
    if (isInt(body.gold, -999_999_999, 999_999_999) && body.gold !== 0) world.changeGold(p, body.gold);
    if ((body.kind === 'item' || body.kind === 'weapon' || body.kind === 'armor') && isInt(body.id, 1, 9999) && isInt(body.quantity, -999, 999) && body.quantity !== 0) {
      world.changeItems(p, body.kind, body.id, body.quantity);
    }
    log(res, 'give', `character:${p.characterId}`, { kind: body.kind, id: body.id, quantity: body.quantity, gold: body.gold });
    res.json({ ok: true });
  });

  router.post('/tools/progress', adminOnly, (req, res) => {
    const body = req.body as { characterId?: unknown; switchId?: unknown; switchValue?: unknown; variableId?: unknown; variableValue?: unknown };
    const p = online(res, body.characterId);
    if (!p) return;
    if (isInt(body.switchId, 1, 9999) && typeof body.switchValue === 'boolean') world.setSwitch(p, body.switchId, body.switchValue);
    if (isInt(body.variableId, 1, 9999) && isInt(body.variableValue, -99_999_999, 99_999_999)) world.setVariable(p, body.variableId, body.variableValue);
    log(res, 'progress', `character:${p.characterId}`, body as Record<string, unknown>);
    res.json({ ok: true, switches: [...p.progress.switches], variables: Object.fromEntries(p.progress.variables) });
  });

  router.post('/tools/announce', adminOnly, (req, res) => {
    const message = text((req.body as { text?: unknown }).text, 300);
    if (!message) return fail(res, 400, 'error.admin.invalid');
    world.announce(message);
    log(res, 'announce', 'server', { text: message });
    res.json({ ok: true });
  });

  // --- Logs ----------------------------------------------------------------------------

  router.get('/logs/:type', (req, res) => {
    const type = req.params.type as LogType;
    if (!LOG_TYPES.includes(type)) return fail(res, 404, 'error.admin.not_found');
    const accountId = Number(req.query.account ?? 0) || 0;
    res.json({ lines: ctx.admin.logs(type, accountId, Math.min(500, Number(req.query.limit ?? 100) || 100)) });
  });

  // --- Backups (administrators) ------------------------------------------------------------

  /** Downloads a consistent copy of the database. */
  router.get('/backup', adminOnly, async (_req, res) => {
    const file = join(PATHS.data, `backup-${Date.now()}.db`);
    try {
      await ctx.db.backup(file);
      log(res, 'backup', 'server');
      res.download(file, `caranille-${sqlDate(Date.now()).replace(/[: ]/g, '-')}.db`, () => {
        if (existsSync(file)) unlinkSync(file);
      });
    } catch (err) {
      if (existsSync(file)) unlinkSync(file);
      throw err;
    }
  });

  /**
   * Receives a backup to restore: it is checked (SQLite file with the schema of
   * this engine) and replaces the database at the next start of the server.
   */
  router.post('/restore', adminOnly, express.raw({ type: '*/*', limit: '500mb' }), (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.subarray(0, 16).toString('latin1') !== 'SQLite format 3\u0000') return fail(res, 400, 'error.admin.invalid_backup');
    const pending = join(PATHS.data, RESTORE_FILE);
    writeFileSync(pending, body);
    if (!checkBackup(pending)) {
      unlinkSync(pending);
      return fail(res, 400, 'error.admin.invalid_backup');
    }
    log(res, 'restore', 'server', { bytes: statSync(pending).size });
    res.json({ ok: true });
  });

  return router;
}

/** Tells whether a file is a database of this engine (has the migrations table and accounts). */
export function checkBackup(file: string): boolean {
  try {
    const header = readFileSync(file).subarray(0, 16).toString('latin1');
    if (header !== 'SQLite format 3\u0000') return false;
    return probeTables(file);
  } catch {
    return false;
  }
}

/** Opens a file read-only and looks for the tables of this engine. */
function probeTables(file: string): boolean {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const names = new Set(db.prepare<[], string>("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all());
    return names.has('schema_migrations') && names.has('accounts') && names.has('characters');
  } finally {
    db.close();
  }
}

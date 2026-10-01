/**
 * @file Attaches the typed socket.io server to the HTTP server.
 *
 * All real-time traffic goes through here. The event contract lives in
 * `shared/protocol.ts`; handlers for each domain (movement, chat, editor...)
 * are registered from this module as features are added.
 *
 * Authentication: the Express session middleware runs on the socket.io engine,
 * so the handshake carries the same session as the web pages. Sockets without a
 * logged-in, non-banned account are refused before `connection` fires.
 * Browsers must also open the connection from the game's own pages: a
 * handshake whose `Origin` names another site is refused (protection against
 * cross-site WebSocket hijacking with the visitor's cookie).
 */
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Session, SessionData } from 'express-session';
import { Server } from 'socket.io';
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '../../shared/protocol.js';
import { isBanned } from '../auth/service.js';
import type { ServerContext } from '../context.js';
import { RateLimiter } from './rate-limit.js';
import { isDirection, isIntIn } from './validate.js';

/** Typed socket.io server used across the engine. */
export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * Tells whether a handshake comes from the game's own origin. Requests without
 * `Origin` are not sent by a browser page (tools, tests) and are accepted: they
 * cannot carry a visitor's cookie without the visitor's knowledge.
 * @param req - Handshake request.
 * @param trustProxy - Behind a reverse proxy, the public host is in `X-Forwarded-Host`.
 */
export function isSameOrigin(req: IncomingMessage, trustProxy: boolean): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const forwarded = trustProxy ? req.headers['x-forwarded-host'] : undefined;
  const expected = (typeof forwarded === 'string' ? forwarded.split(',')[0]!.trim() : undefined) ?? req.headers.host;
  return host !== '' && host === expected;
}

/** Handshake request once the session middleware has run. */
type SessionRequest = IncomingMessage & { session?: Session & Partial<SessionData> };

/**
 * Creates the socket.io server and registers connection handlers.
 * @param httpServer - Node HTTP server shared with Express.
 * @param ctx - Server context.
 */
export function createSocketServer(httpServer: HttpServer, ctx: ServerContext): GameServer {
  const io: GameServer = new Server(httpServer, {
    serveClient: false,
    // Keep payloads small: nothing legitimate in the protocol exceeds this.
    maxHttpBufferSize: 1e6,
    allowRequest: (req, callback) => callback(null, isSameOrigin(req, ctx.config.trustProxy)),
  });

  // Run the Express session middleware on the engine's HTTP handshake requests.
  io.engine.use(ctx.sessionMiddleware);
  ctx.world.attach(io);

  io.use((socket, next) => {
    const req = socket.request as SessionRequest;
    const accountId = req.session?.accountId;
    const account = accountId === undefined ? undefined : ctx.accounts.findById(accountId);
    if (!account) {
      next(new Error('error.auth.not_authenticated'));
      return;
    }
    if (isBanned(account)) {
      next(new Error('error.auth.banned'));
      return;
    }
    const character = ctx.characterService.owned(account.id, req.session?.characterId);
    if (!character) {
      next(new Error('error.character.not_selected'));
      return;
    }
    socket.data.accountId = account.id;
    socket.data.username = account.username;
    socket.data.role = account.role;
    socket.data.characterId = character.id;
    next();
  });

  io.on('connection', (socket) => {
    // socket.io calls handlers outside any try: an exception (or a rejected promise) in one
    // handler is logged instead of stopping the whole server.
    const listen = socket.on.bind(socket);
    socket.on = ((event: string, listener: (...args: unknown[]) => unknown) =>
      listen(event as never, ((...args: unknown[]) => {
        const fail = (err: unknown) => console.error(`[caranille] socket handler "${event}" failed`, err);
        try {
          const result = listener(...args);
          if (result instanceof Promise) result.catch(fail);
        } catch (err) {
          fail(err);
        }
      }) as never)) as typeof socket.on;
    const limiter = new RateLimiter();
    socket.use((_packet, next) => {
      const verdict = limiter.take();
      if (verdict === 'ok') {
        next();
        return;
      }
      if (verdict === 'kick') {
        socket.emit('errorMessage', { key: 'error.net.rate_limited' });
        socket.disconnect(true);
        return;
      }
      // Warn on the first dropped event of a burst, then stay quiet.
      if (limiter.droppedCount === 1) socket.emit('errorMessage', { key: 'error.net.rate_limited' });
    });
    socket.emit('welcome', { protocol: PROTOCOL_VERSION, serverTime: Date.now() });
    const character = ctx.characters.findById(socket.data.characterId);
    const payload = character ? ctx.world.join(socket, character) : null;
    if (!character || !payload) {
      socket.emit('errorMessage', { key: 'error.net.no_map' });
      socket.disconnect(true);
      return;
    }
    ctx.characters.touchPlayed(character.id);
    const ip = socket.handshake.address ?? '';
    ctx.admin.logConnection(socket.data.accountId, character.id, 'login', ip);
    socket.emit('enterWorld', payload);
    const joined = ctx.world.player(character.id);
    if (joined) {
      ctx.world.pushInventory(joined);
      ctx.world.afterEnter(joined);
    }

    /** The session of this socket, if it is still the active one for the character. */
    const session = () => {
      const p = ctx.world.player(character.id);
      return p?.socket.id === socket.id ? p : undefined;
    };

    socket.on('ping', (_sentAt, ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });
    socket.on('move', (direction, epoch) => {
      const p = session();
      if (p && isDirection(direction) && isIntIn(epoch, 0, Number.MAX_SAFE_INTEGER)) ctx.world.move(p, direction, epoch);
    });
    socket.on('turn', (direction) => {
      const p = session();
      if (p && isDirection(direction)) ctx.world.turn(p, direction);
    });
    socket.on('useItem', (itemId) => {
      const p = session();
      if (p && isIntIn(itemId, 1, 9999)) ctx.world.useItem(p, itemId);
    });
    socket.on('action', () => {
      const p = session();
      if (p) ctx.world.action(p);
    });
    socket.on('attack', () => {
      const p = session();
      if (p) ctx.world.combat.attack(p);
    });
    socket.on('useSkill', (skillId) => {
      const p = session();
      if (p && isIntIn(skillId, 1, 9999)) ctx.world.combat.useSkill(p, skillId);
    });
    const kinds = ['item', 'weapon', 'armor'] as const;
    const isKind = (k: unknown): k is (typeof kinds)[number] => kinds.includes(k as 'item');
    socket.on('equip', (slot, id) => {
      const p = session();
      if (!p || typeof slot !== 'string' || !isIntIn(id, 0, 9999)) return;
      const error = ctx.world.sheet.equip(p, slot, id);
      if (error) socket.emit('notify', { key: error });
    });
    socket.on('allocate', (param) => {
      const p = session();
      if (p && typeof param === 'string') ctx.world.sheet.allocate(p, param);
    });
    socket.on('discard', (kind, id, quantity) => {
      const p = session();
      if (p && isKind(kind) && isIntIn(id, 1, 9999) && isIntIn(quantity, 1, 9999)) ctx.world.sheet.discard(p, kind, id, quantity);
    });
    socket.on('shopBuy', (index, quantity) => {
      const p = session();
      if (p && isIntIn(index, 0, 999) && isIntIn(quantity, 1, 99)) ctx.world.sheet.buy(p, index, quantity);
    });
    socket.on('shopSell', (kind, id, quantity) => {
      const p = session();
      if (p && isKind(kind) && isIntIn(id, 1, 9999) && isIntIn(quantity, 1, 99)) ctx.world.sheet.sell(p, kind, id, quantity);
    });
    socket.on('bankMove', (kind, id, quantity, toBank) => {
      const p = session();
      if (p && isKind(kind) && isIntIn(id, 1, 9999) && isIntIn(quantity, 1, 9999) && typeof toBank === 'boolean') ctx.world.sheet.bankMove(p, kind, id, quantity, toBank);
    });
    socket.on('bankGold', (amount) => {
      const p = session();
      if (p && isIntIn(amount, -999_999_999, 999_999_999)) ctx.world.sheet.bankGold(p, amount);
    });
    const channels = ['map', 'global', 'party', 'guild'] as const;
    socket.on('chat', (text, channel) => {
      const p = session();
      if (p && typeof text === 'string' && text.length <= 1000 && channels.includes(channel)) ctx.world.social.chat(p, text, channel);
    });
    socket.on('emote', (balloon) => {
      const p = session();
      if (p && isIntIn(balloon, 1, 10)) ctx.world.social.emote(p, balloon);
    });
    socket.on('friendAdd', (name) => {
      const p = session();
      if (p && typeof name === 'string' && name.length <= 40) ctx.world.social.addFriend(p, name);
    });
    socket.on('friendRemove', (id) => {
      const p = session();
      if (p && isIntIn(id, 1, Number.MAX_SAFE_INTEGER)) ctx.world.social.removeFriend(p, id);
    });
    socket.on('ignore', (name) => {
      const p = session();
      if (p && typeof name === 'string' && name.length <= 40) ctx.world.social.ignore(p, name);
    });
    socket.on('unignore', (id) => {
      const p = session();
      if (p && isIntIn(id, 1, Number.MAX_SAFE_INTEGER)) ctx.world.social.unignore(p, id);
    });
    socket.on('inspect', (id) => {
      const p = session();
      if (p && isIntIn(id, 1, Number.MAX_SAFE_INTEGER)) ctx.world.social.inspect(p, id);
    });
    socket.on('report', (id, reason) => {
      const p = session();
      if (p && isIntIn(id, 1, Number.MAX_SAFE_INTEGER) && typeof reason === 'string' && reason.length <= 1000) ctx.world.social.report(p, id, reason);
    });
    socket.on('tradeRequest', (id) => {
      const p = session();
      if (p && isIntIn(id, 1, Number.MAX_SAFE_INTEGER)) ctx.world.trade.request(p, id);
    });
    socket.on('tradeRespond', (accept) => {
      const p = session();
      if (p && typeof accept === 'boolean') ctx.world.trade.respond(p, accept);
    });
    socket.on('tradeOffer', (offer) => {
      const p = session();
      if (!p || typeof offer !== 'object' || offer === null || !Array.isArray(offer.items) || offer.items.length > 50) return;
      ctx.world.trade.offer(p, { items: offer.items.filter((i) => i && isKind(i.kind) && isIntIn(i.id, 1, 9999) && isIntIn(i.quantity, 1, 9999)), gold: isIntIn(offer.gold, 0, 999_999_999) ? offer.gold : 0 });
    });
    socket.on('tradeLock', () => {
      const p = session();
      if (p) ctx.world.trade.lock(p);
    });
    socket.on('tradeConfirm', () => {
      const p = session();
      if (p) ctx.world.trade.confirm(p);
    });
    socket.on('tradeCancel', () => {
      const p = session();
      if (p) ctx.world.trade.cancel(p);
    });
    const onP = <A extends unknown[]>(check: (...args: A) => boolean, run: (p: NonNullable<ReturnType<typeof session>>, ...args: A) => void) => (...args: A) => {
      const p = session();
      if (p && check(...args)) run(p, ...args);
    };
    const anyId = (id: unknown) => isIntIn(id, 1, Number.MAX_SAFE_INTEGER);
    const text = (s: unknown, max: number) => typeof s === 'string' && s.length <= max;
    socket.on('partyInvite', onP((id: number) => anyId(id), (p, id) => ctx.world.party.invite(p, id)));
    socket.on('partyRespond', onP((a: boolean) => typeof a === 'boolean', (p, a) => ctx.world.party.respond(p, a)));
    socket.on('partyLeave', onP(() => true, (p) => ctx.world.party.leave(p)));
    socket.on('partyKick', onP((id: number) => anyId(id), (p, id) => ctx.world.party.kick(p, id)));
    socket.on('partyPromote', onP((id: number) => anyId(id), (p, id) => ctx.world.party.promote(p, id)));
    socket.on('lootChoice', onP((id: number, c: 'need' | 'greed' | 'pass') => anyId(id) && ['need', 'greed', 'pass'].includes(c), (p, id, c) => ctx.world.raids.choose(p, id, c)));
    socket.on('partyRaid', onP((r: boolean) => typeof r === 'boolean', (p, r) => ctx.world.party.setRaid(p, r)));
    socket.on('partyLoot', onP((l: 'personal' | 'shared') => l === 'personal' || l === 'shared', (p, l) => ctx.world.party.setLoot(p, l)));
    socket.on('guildCreate', onP((n: string, t: string, _e: unknown) => text(n, 40) && text(t, 10), (p, n, t, e) => ctx.world.guilds.create(p, n, t, e)));
    socket.on('guildInvite', onP((id: number) => anyId(id), (p, id) => ctx.world.guilds.invite(p, id)));
    socket.on('guildRespond', onP((a: boolean) => typeof a === 'boolean', (p, a) => ctx.world.guilds.respond(p, a)));
    socket.on('guildLeave', onP(() => true, (p) => ctx.world.guilds.leave(p)));
    socket.on('guildKick', onP((id: number) => anyId(id), (p, id) => ctx.world.guilds.kick(p, id)));
    socket.on('guildSetRank', onP((id: number, r: number) => anyId(id) && isIntIn(r, 0, 9), (p, id, r) => ctx.world.guilds.setMemberRank(p, id, r)));
    socket.on('guildEditRank', onP((r: number, n: string, perm: number) => isIntIn(r, 0, 9) && text(n, 40) && isIntIn(perm, 0, 63), (p, r, n, perm) => ctx.world.guilds.editRank(p, r, n, perm)));
    socket.on('guildMotd', onP((m: string) => text(m, 1000), (p, m) => ctx.world.guilds.setMotd(p, m)));
    socket.on('guildBank', onP((k: 'item' | 'weapon' | 'armor', id: number, q: number, d: boolean) => isKind(k) && isIntIn(id, 1, 9999) && isIntIn(q, 1, 9999) && typeof d === 'boolean', (p, k, id, q, d) => ctx.world.guilds.bankItems(p, k, id, q, d)));
    socket.on('guildGold', onP((a: number) => isIntIn(a, -999_999_999, 999_999_999), (p, a) => ctx.world.guilds.bankGold(p, a)));
    socket.on('setHotbar', (slots) => {
      const p = session();
      if (p && Array.isArray(slots) && slots.length <= 32) ctx.world.combat.setHotbar(p, slots);
    });
    socket.on('disconnect', () => {
      ctx.admin.logConnection(socket.data.accountId, character.id, 'logout', ip);
      if (session()) ctx.world.leave(character.id);
      // An administrator leaving the game also leaves the editor.
      if (socket.data.role === 'admin') ctx.editLocks.releaseAll(socket.data.accountId);
    });
  });

  return io;
}

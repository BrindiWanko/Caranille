/**
 * @file Secure trades between two players.
 *
 * 1. A player asks another one, standing near it on the same map; the other
 *    accepts or declines.
 * 2. Both build their offer (items of their bag and gold); any change of an
 *    offer unlocks and unconfirms both sides.
 * 3. Each side locks its offer (it cannot change any more), then, once both
 *    are locked, each side confirms.
 * 4. When both confirmed, the server executes the exchange in one database
 *    transaction that checks everything again (see SocialRepository.trade).
 *
 * The trade is cancelled if a player leaves, changes map, walks away, dies or
 * cancels. Completed trades are logged for the administrators.
 */
import { MAX_TRADE_ITEMS, type TradeSide, type TradeView } from '../../shared/social.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import type { ItemKind } from '../db/inventory.js';
import type { TradeOffer } from '../db/social.js';
import { sameZone, type PlayerSession, type World } from './world.js';

/** Largest distance (cells) between the two traders. */
const TRADE_DISTANCE = 6;
/** A request expires after this delay. */
const REQUEST_MS = 30_000;

interface Side {
  p: PlayerSession;
  offer: TradeOffer;
  locked: boolean;
  confirmed: boolean;
}

interface Trade {
  a: Side;
  b: Side;
}

const near = (a: PlayerSession, b: PlayerSession) => sameZone(a, b) && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= TRADE_DISTANCE;

/** Trades for the whole world. */
export class TradeService {
  /** Trade of each trading character. */
  private readonly trades = new Map<number, Trade>();
  /** Pending requests: target → requester and time. */
  private readonly requests = new Map<number, { from: number; at: number }>();

  constructor(private readonly world: World) {}

  private get ctx() {
    return this.world.ctx;
  }

  /** Tells whether a player can start a trade now. */
  private free(p: PlayerSession): boolean {
    return this.world.isLive(p) && !p.busy && !p.combat.dead && !this.trades.has(p.characterId);
  }

  /** Asks another player for a trade. */
  request(p: PlayerSession, targetId: number): void {
    const target = this.world.player(targetId);
    if (!target || target === p || !this.world.isLive(target)) {
      p.socket.emit('notify', { key: 'error.trade.unavailable' });
      return;
    }
    if (!near(p, target)) {
      p.socket.emit('notify', { key: 'error.trade.too_far' });
      return;
    }
    if (!this.free(p) || !this.free(target) || this.world.social.ignores(target, p.characterId)) {
      p.socket.emit('notify', { key: 'error.trade.unavailable' });
      return;
    }
    this.requests.set(target.characterId, { from: p.characterId, at: Date.now() });
    target.socket.emit('tradeRequest', { id: p.characterId, name: p.name });
    p.socket.emit('notify', { key: 'notify.trade_requested', params: { name: target.name } });
  }

  /** Answers a pending request. */
  respond(p: PlayerSession, accept: boolean): void {
    const req = this.requests.get(p.characterId);
    this.requests.delete(p.characterId);
    if (!req || Date.now() - req.at > REQUEST_MS) return;
    const from = this.world.player(req.from);
    if (!from) return;
    if (!accept) {
      from.socket.emit('notify', { key: 'notify.trade_declined', params: { name: p.name } });
      return;
    }
    if (!this.free(p) || !this.free(from) || !near(p, from)) {
      p.socket.emit('notify', { key: 'error.trade.unavailable' });
      return;
    }
    const side = (who: PlayerSession): Side => ({ p: who, offer: { items: [], gold: 0 }, locked: false, confirmed: false });
    const trade: Trade = { a: side(from), b: side(p) };
    this.trades.set(from.characterId, trade);
    this.trades.set(p.characterId, trade);
    this.push(trade);
  }

  private sides(p: PlayerSession): { trade: Trade; mine: Side; theirs: Side } | null {
    const trade = this.trades.get(p.characterId);
    if (!trade) return null;
    return trade.a.p === p ? { trade, mine: trade.a, theirs: trade.b } : { trade, mine: trade.b, theirs: trade.a };
  }

  /** Replaces a player's offer (checked against what it owns). */
  offer(p: PlayerSession, offer: TradeOffer): void {
    const s = this.sides(p);
    if (!s || s.mine.locked) return;
    const inv = this.ctx.inventory;
    const items = new Map<string, TradeOffer['items'][number]>();
    for (const it of offer.items.slice(0, MAX_TRADE_ITEMS)) {
      if (!['item', 'weapon', 'armor'].includes(it.kind) || !Number.isInteger(it.id) || !Number.isInteger(it.quantity) || it.quantity < 1) continue;
      // Key and quest items stay with their owner.
      if (it.kind === 'item' && this.ctx.gameData.get('item', it.id)?.kind !== 'regular') continue;
      const owned = inv.quantity(p.characterId, it.kind, it.id);
      if (owned < 1) continue;
      items.set(`${it.kind}:${it.id}`, { kind: it.kind, id: it.id, quantity: Math.min(owned, it.quantity) });
    }
    const gold = Math.max(0, Math.min(inv.gold(p.characterId), Math.trunc(offer.gold) || 0));
    s.mine.offer = { items: [...items.values()], gold };
    // Any change must be seen again by both players.
    for (const side of [s.mine, s.theirs]) {
      side.locked = false;
      side.confirmed = false;
    }
    this.push(s.trade);
  }

  /** Locks a player's offer. */
  lock(p: PlayerSession): void {
    const s = this.sides(p);
    if (!s || s.mine.locked) return;
    s.mine.locked = true;
    this.push(s.trade);
  }

  /** Confirms the trade (both offers locked); executes it when both confirmed. */
  confirm(p: PlayerSession): void {
    const s = this.sides(p);
    if (!s || !s.mine.locked || !s.theirs.locked) return;
    s.mine.confirmed = true;
    if (!s.theirs.confirmed) {
      this.push(s.trade);
      return;
    }
    const { a, b } = s.trade;
    if (!near(a.p, b.p)) {
      this.close(s.trade, 'error.trade.too_far');
      return;
    }
    const inv = this.ctx.inventoryService;
    const result = this.ctx.social.trade(a.p.characterId, b.p.characterId, a.offer, b.offer, (k, id) => inv.maxOf(k, id), this.ctx.settings.get('bagSize', DEFAULT_SETTINGS.bagSize));
    if (result) {
      // Nothing moved: both sides may fix their offer and try again.
      for (const side of [a, b]) {
        side.locked = false;
        side.confirmed = false;
        side.p.socket.emit('notify', { key: result });
      }
      this.push(s.trade);
      return;
    }
    this.close(s.trade, null);
    for (const side of [a, b]) {
      side.p.socket.emit('notify', { key: 'notify.trade_done' });
      side.p.socket.emit('playerUpdate', { gold: this.ctx.inventory.gold(side.p.characterId) });
      this.world.pushInventory(side.p);
      this.world.refreshEvents(side.p);
    }
  }

  /** Cancels the trade of a player (button, leaving, map change, death). */
  cancel(p: PlayerSession, reason = 'notify.trade_cancelled'): void {
    this.requests.delete(p.characterId);
    const trade = this.trades.get(p.characterId);
    if (trade) this.close(trade, reason);
  }

  /** A player moved: the trade stops if the players are too far apart. */
  moved(p: PlayerSession): void {
    const s = this.sides(p);
    if (s && !near(s.mine.p, s.theirs.p)) this.close(s.trade, 'error.trade.too_far');
  }

  private close(trade: Trade, reason: string | null): void {
    for (const side of [trade.a, trade.b]) {
      this.trades.delete(side.p.characterId);
      if (!this.world.isLive(side.p)) continue;
      side.p.socket.emit('trade', null);
      if (reason) side.p.socket.emit('notify', { key: reason });
    }
  }

  /** What one side shows. */
  private sideView(side: Side): TradeSide {
    const data = this.ctx.gameData;
    const items = side.offer.items.flatMap((it) => {
      const def = it.kind === 'item' ? data.get('item', it.id) : it.kind === 'weapon' ? data.get('weapon', it.id) : data.get('armor', it.id);
      return def ? [{ kind: it.kind as ItemKind, id: it.id, quantity: it.quantity, name: def.name, icon: def.icon }] : [];
    });
    return { items, gold: side.offer.gold, locked: side.locked, confirmed: side.confirmed };
  }

  /** Sends the trade window to both players. */
  private push(trade: Trade): void {
    for (const [mine, theirs] of [[trade.a, trade.b], [trade.b, trade.a]] as const) {
      const view: TradeView = { partner: { id: theirs.p.characterId, name: theirs.p.name }, mine: this.sideView(mine), theirs: this.sideView(theirs) };
      mine.p.socket.emit('trade', view);
    }
  }
}

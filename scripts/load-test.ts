/**
 * @file Load test: starts a server in memory, connects many simulated
 * players to the same map and makes them walk, chat and attack for a while,
 * then reports the server's health: event loop lag, duration of the world
 * tick, and the traffic each client received.
 *
 * Usage: `npm run load-test -- [clients] [seconds]` (default 50 clients, 20 s).
 * The run fails (exit code 1) when the server degrades noticeably: event
 * loop lag p95 above 50 ms, or world tick p95 above 15 ms.
 */
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import { io as connect, type Socket } from 'socket.io-client';
import { DEFAULT_APPEARANCE } from '../shared/art/character.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol.js';
import type { Direction } from '../shared/settings.js';
import { createApp } from '../server/app.js';
import { config } from '../server/config.js';
import { closeContext, createContext } from '../server/context.js';
import { createSocketServer } from '../server/net/socket.js';

/** Result of a load test. */
export interface LoadReport {
  clients: number;
  seconds: number;
  lagP50: number;
  lagP95: number;
  lagMax: number;
  tickP95: number;
  tickMax: number;
  /** Events received per client per second (average). */
  eventsPerClientSecond: number;
  /** Moves sent and moves accepted by the server. */
  moves: number;
  accepted: number;
  rejectedRate: number;
  heapMb: number;
}

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
};

/** Minimal cookie-keeping HTTP client. */
class Client {
  private readonly cookies = new Map<string, string>();
  constructor(private readonly base: string) {}
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set('cookie', this.header());
    const res = await fetch(this.base + path, { ...init, headers, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const eq = pair.indexOf('=');
      this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    return res;
  }
  async csrf(path: string): Promise<string> {
    const html = await (await this.request(path)).text();
    return /name="_csrf" value="([^"]+)"/.exec(html)![1]!;
  }
  post(path: string, fields: Record<string, string>): Promise<Response> {
    return this.request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
  }
}

/**
 * Runs a load test.
 * @param clients - Simulated players.
 * @param seconds - Duration of the simulation.
 */
export async function runLoadTest(clients: number, seconds: number): Promise<LoadReport> {
  const ctx = createContext({ ...config, dbPath: ':memory:', sessionSecret: 'load-test' }, { bcryptRounds: 4 });
  const http = createServer(createApp(ctx));
  const io = createSocketServer(http, ctx);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  // Accounts and characters are created directly (one shared password hash).
  const hash = await bcrypt.hash('load test password', 4);
  const start = ctx.settings.get('startPosition', { mapId: 1, x: 20, y: 17, direction: 2 as Direction });
  const sockets: Socket<ServerToClientEvents, ClientToServerEvents>[] = [];
  let received = 0;
  for (let i = 0; i < clients; i++) {
    const name = `Bot${String(i).padStart(3, '0')}`;
    const account = ctx.accounts.create({ username: name, email: `${name}@load.test`, passwordHash: hash, locale: 'fr' });
    const character = ctx.characters.create({ accountId: account.id, name, classId: 1, appearance: DEFAULT_APPEARANCE, hp: 120, mp: 20, gold: 0, mapId: start.mapId, x: start.x, y: start.y, direction: 2 }, 4);
    const client = new Client(url);
    await client.post('/login', { _csrf: await client.csrf('/login'), username: name, password: 'load test password' });
    await client.post(`/characters/${character.id}/play`, { _csrf: await client.csrf('/characters') });
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = connect(url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.header() } });
    socket.onAny(() => received++);
    await new Promise<void>((resolve, reject) => {
      socket.once('enterWorld', () => resolve());
      socket.once('connect_error', reject);
    });
    sockets.push(socket);
  }

  // Measurements: event loop lag and world tick duration.
  const lags: number[] = [];
  let expected = Date.now() + 50;
  const lagTimer = setInterval(() => {
    const now = Date.now();
    lags.push(Math.max(0, now - expected));
    expected = now + 50;
  }, 50);
  const ticks: number[] = [];
  const world = ctx.world;
  const originalTick = world.tick.bind(world);
  world.tick = () => {
    const t0 = performance.now();
    originalTick();
    ticks.push(performance.now() - t0);
  };
  let rejected = 0;
  let moves = 0;
  const epochs = sockets.map(() => 0);
  sockets.forEach((s, i) => s.on('moveRejected', ({ epoch }) => {
    rejected++;
    epochs[i] = epoch;
  }));
  received = 0;

  // The simulation: walk every ~300 ms, chat now and then, attack sometimes.
  const dirs: Direction[] = [2, 4, 6, 8];
  const behaviours = sockets.map((s, i) => {
    let dir = dirs[i % 4]!;
    return setInterval(() => {
      if (Math.random() < 0.25) dir = dirs[Math.floor(Math.random() * 4)]!;
      s.emit('move', dir, epochs[i]!);
      moves++;
      if (Math.random() < 0.02) s.emit('chat', `Bonjour de ${i}`, 'map');
      if (Math.random() < 0.05) s.emit('attack');
    }, 280 + Math.floor(Math.random() * 60));
  });
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const elapsed = (Date.now() - t0) / 1000;
  for (const b of behaviours) clearInterval(b);
  clearInterval(lagTimer);
  const report: LoadReport = {
    clients,
    seconds: Math.round(elapsed),
    lagP50: percentile(lags, 50),
    lagP95: percentile(lags, 95),
    lagMax: Math.max(0, ...lags),
    tickP95: Math.round(percentile(ticks, 95) * 100) / 100,
    tickMax: Math.round(Math.max(0, ...ticks) * 100) / 100,
    eventsPerClientSecond: Math.round(received / clients / elapsed),
    moves,
    accepted: moves - rejected,
    rejectedRate: moves ? Math.round((rejected / moves) * 100) / 100 : 0,
    heapMb: Math.round(process.memoryUsage().heapUsed / 1048576),
  };
  for (const s of sockets) s.close();
  http.closeAllConnections();
  await io.close();
  closeContext(ctx);
  return report;
}

// Command line.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const clients = Number(process.argv[2] ?? 50) || 50;
  const seconds = Number(process.argv[3] ?? 20) || 20;
  console.log(`[load-test] ${clients} clients, ${seconds} s…`);
  const report = await runLoadTest(clients, seconds);
  console.table(report);
  const ok = report.lagP95 <= 50 && report.tickP95 <= 15;
  console.log(ok ? '[load-test] OK: no noticeable degradation' : '[load-test] DEGRADED');
  process.exit(ok ? 0 : 1);
}

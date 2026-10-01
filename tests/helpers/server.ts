/**
 * @file Test helpers: starts a full server (Express + socket.io) on an in-memory
 * database and an ephemeral port, and provides a tiny cookie-keeping HTTP client.
 */
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { createApp } from '../../server/app.js';
import { config } from '../../server/config.js';
import { closeContext, createContext, type ServerContext } from '../../server/context.js';
import { createSocketServer, type GameServer } from '../../server/net/socket.js';

/** A running test server. */
export interface TestServer {
  ctx: ServerContext;
  url: string;
  http: Server;
  io: GameServer;
  close(): Promise<void>;
}

/** Starts a server on a random port with a fresh in-memory database. */
export async function startTestServer(): Promise<TestServer> {
  const ctx = createContext({ ...config, dbPath: ':memory:', sessionSecret: 'test-secret' }, { bcryptRounds: 4 });
  const http = createServer(createApp(ctx));
  const io = createSocketServer(http, ctx);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address() as AddressInfo;
  return {
    ctx,
    url: `http://127.0.0.1:${port}`,
    http,
    io,
    async close() {
      // fetch() keeps idle keep-alive sockets open, which would stop the test process from exiting.
      http.closeAllConnections();
      await io.close();
      closeContext(ctx);
    },
  };
}

/** Minimal browser-like client: keeps cookies between requests and never follows redirects. */
export class TestClient {
  readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  /** Value of the `Cookie` header to send. */
  cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** Performs a request, storing any cookie set by the response. */
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) headers.set('cookie', this.cookieHeader());
    const res = await fetch(this.baseUrl + path, { ...init, headers, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (/expires=Thu, 01 Jan 1970/i.test(line) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  /** GETs a page and extracts the CSRF token of its first form. */
  async csrf(path: string): Promise<string> {
    const html = await (await this.request(path)).text();
    const match = /name="_csrf" value="([^"]+)"/.exec(html);
    if (!match) throw new Error(`No CSRF token on ${path}`);
    return match[1]!;
  }

  /** Submits a URL-encoded form. */
  post(path: string, fields: Record<string, string>): Promise<Response> {
    return this.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
  }
}

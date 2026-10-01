/**
 * @file HTTP session middleware.
 *
 * The same middleware instance is mounted on Express and on the socket.io
 * engine, so a WebSocket connection is authenticated by the very same session
 * cookie as the web pages.
 */
import type { RequestHandler } from 'express';
import session from 'express-session';
import type { Config } from '../config.js';
import type { SqliteSessionStore } from '../db/session-store.js';
import './session-data.js';

/** Name of the session cookie. */
export const SESSION_COOKIE = 'caranille.sid';

/**
 * Creates the session middleware.
 * @param config - Server configuration (lifetime, production flag).
 * @param store - SQLite session store.
 * @param secret - Cookie signing secret.
 */
export function createSessionMiddleware(config: Config, store: SqliteSessionStore, secret: string): RequestHandler {
  return session({
    name: SESSION_COOKIE,
    secret,
    store,
    resave: false,
    // Anonymous visitors get no session row until something is stored in it.
    saveUninitialized: false,
    // Sliding expiration: every request pushes the expiry back.
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.production,
      maxAge: config.sessionMaxAgeMs,
    },
  });
}

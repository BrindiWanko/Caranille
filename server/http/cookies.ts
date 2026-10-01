/**
 * @file Minimal cookie reader. Only a couple of plain cookies are read directly
 * (the session cookie is handled by express-session), so a full cookie-parsing
 * middleware is not needed.
 */
import type { IncomingMessage } from 'node:http';

/**
 * Reads one cookie from a request's `Cookie` header.
 * @param req - Any Node request (Express or raw socket.io handshake).
 * @param name - Cookie name.
 * @returns The decoded value, or `undefined` if absent or malformed.
 */
export function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Validates a post-action redirect target so it can only point inside this site.
 * Rejects absolute URLs and protocol-relative `//host` forms (open-redirect protection).
 * @param target - Untrusted value (query string, form field).
 * @param fallback - Path used when `target` is unsafe.
 */
export function safeRedirectPath(target: unknown, fallback = '/'): string {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || target.includes('\\')) {
    return fallback;
  }
  return target;
}

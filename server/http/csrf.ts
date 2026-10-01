/**
 * @file Anti-CSRF protection for HTML forms (synchronizer token pattern).
 *
 * Each session holds a random token; views embed it in a hidden `_csrf` field
 * and every state-changing form POST must send it back. `SameSite=Lax` cookies
 * already block most cross-site posts; the token covers older browsers and
 * same-site subdomain attacks.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import './session-data.js';

/**
 * Returns the session's CSRF token, creating it if needed.
 * @param req - Request with a session.
 */
export function csrfToken(req: Request): string {
  req.session.csrfToken ??= randomBytes(24).toString('base64url');
  return req.session.csrfToken;
}

/**
 * Middleware exposing `csrfToken` to views (lazily created on first use).
 */
export function exposeCsrf(req: Request, res: Response, next: NextFunction): void {
  res.locals.csrfToken = () => csrfToken(req);
  next();
}

/**
 * Middleware rejecting POST requests whose `_csrf` field does not match the session token.
 */
export function verifyCsrf(req: Request, res: Response, next: NextFunction): void {
  const expected = req.session.csrfToken;
  const sent: unknown = (req.body as Record<string, unknown> | undefined)?._csrf;
  if (
    typeof expected === 'string' &&
    typeof sent === 'string' &&
    sent.length === expected.length &&
    timingSafeEqual(Buffer.from(sent), Buffer.from(expected))
  ) {
    next();
    return;
  }
  res.status(403).render('error', { code: 403, messageKey: 'error.http.csrf' });
}

/**
 * Middleware protecting JSON APIs: the page sends the session's CSRF token in
 * the `X-CSRF-Token` header (a cross-site form cannot set custom headers).
 * Safe methods (GET, HEAD) are not checked.
 */
export function verifyCsrfHeader(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD') {
    next();
    return;
  }
  const expected = req.session.csrfToken;
  const sent = req.get('x-csrf-token');
  if (typeof expected === 'string' && typeof sent === 'string' && sent.length === expected.length && timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) {
    next();
    return;
  }
  res.status(403).json({ error: 'error.http.csrf' });
}

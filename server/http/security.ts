/**
 * @file HTTP security headers sent with every page and API answer.
 *
 * - Content Security Policy: scripts, styles, images, sounds and sockets only
 *   from this server (no inline script runs; the translation and data blocks
 *   embedded in pages are JSON, not code), `data:` and `blob:` images and
 *   sounds for generated graphics, no framing.
 * - `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options`,
 *   `Cross-Origin-Opener-Policy`, a restrictive `Permissions-Policy`, and
 *   HSTS in production (behind HTTPS).
 */
import type { RequestHandler } from 'express';

/** Content Security Policy of the site. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // Interface code sets styles through the CSSOM; a few templates use style attributes.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Creates the middleware adding the security headers.
 * @param production - Adds HSTS (the site is then served over HTTPS).
 */
export function securityHeaders(production: boolean): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

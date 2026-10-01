/**
 * @file Registration, login and logout pages.
 *
 * Forms are plain HTML posts (they work without JavaScript). On success the
 * session id is regenerated before storing the account id, which prevents
 * session fixation. Errors re-render the form with a translation key and the
 * previously typed values (never the password).
 */
import { Router, type Request, type Response } from 'express';
import { isLocale, type Locale } from '../../shared/i18n.js';
import type { ServerContext } from '../context.js';
import type { Account } from '../db/accounts.js';
import { safeRedirectPath } from '../http/cookies.js';
import { verifyCsrf } from '../http/csrf.js';
import { SESSION_COOKIE } from '../http/session.js';
import { setLocaleCookie } from '../i18n.js';
import { currentAccount } from './middleware.js';

/** Where players land after logging in. */
export const AFTER_LOGIN_PATH = '/characters';

function field(req: Request, name: string): string {
  const value: unknown = (req.body as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : '';
}

/** Opens an authenticated session for an account (with a fresh session id). */
function startSession(req: Request, res: Response, account: Account, next: string): void {
  req.session.regenerate((err) => {
    if (err) {
      res.status(500).render('error', { code: 500, messageKey: 'error.http.server' });
      return;
    }
    req.session.accountId = account.id;
    req.session.locale = account.locale;
    if (isLocale(account.locale)) setLocaleCookie(res, account.locale);
    req.session.save(() => res.redirect(303, next));
  });
}

/**
 * Creates the router of authentication pages.
 * @param ctx - Server context.
 */
export function authRouter(ctx: ServerContext): Router {
  const router = Router();

  router.get('/login', (req, res) => {
    if (currentAccount(res)) {
      res.redirect(303, AFTER_LOGIN_PATH);
      return;
    }
    res.render('auth/login', { errorKey: null, errorParams: {}, values: {}, next: safeRedirectPath(req.query.next, '') });
  });

  router.post('/login', verifyCsrf, async (req, res) => {
    const username = field(req, 'username');
    const next = safeRedirectPath(field(req, 'next'), AFTER_LOGIN_PATH);
    const result = await ctx.auth.login(username, field(req, 'password'), req.ip ?? 'unknown');
    if (!result.ok) {
      res.status(result.errorKey === 'error.auth.too_many_attempts' ? 429 : 401).render('auth/login', {
        errorKey: result.errorKey,
        errorParams: result.params ?? {},
        values: { username },
        next,
      });
      return;
    }
    startSession(req, res, result.account, next);
  });

  router.get('/register', (_req, res) => {
    if (currentAccount(res)) {
      res.redirect(303, AFTER_LOGIN_PATH);
      return;
    }
    res.render('auth/register', { errorKey: null, values: {}, isFirstAccount: ctx.accounts.count() === 0 });
  });

  router.post('/register', verifyCsrf, async (req, res) => {
    const values = { username: field(req, 'username'), email: field(req, 'email') };
    const locale = res.locals.locale as Locale;
    const result = await ctx.auth.register(
      { ...values, password: field(req, 'password'), passwordConfirm: field(req, 'passwordConfirm') },
      locale,
    );
    if (!result.ok) {
      res.status(400).render('auth/register', { errorKey: result.errorKey, values, isFirstAccount: ctx.accounts.count() === 0 });
      return;
    }
    if (result.account.role === 'admin') console.log(`[caranille] first account "${result.account.username}" registered as admin`);
    startSession(req, res, result.account, AFTER_LOGIN_PATH);
  });

  router.post('/logout', verifyCsrf, (req, res) => {
    req.session.destroy(() => {
      res.clearCookie(SESSION_COOKIE);
      res.redirect(303, '/');
    });
  });

  return router;
}

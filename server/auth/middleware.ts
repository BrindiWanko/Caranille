/**
 * @file Express middlewares for authentication and role checks.
 *
 * `loadAccount` resolves the session's account once per request and exposes a
 * safe summary (`res.locals.account`, no password hash) to views. Every page
 * or API that needs a role goes through `requireRole`: hiding a button on the
 * client is never considered a protection.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AccountRole } from '../../shared/protocol.js';
import { hasRole } from '../../shared/roles.js';
import type { Account, AccountRepository } from '../db/accounts.js';
import { isBanned } from './service.js';

/** Account data safe to expose to views and the client. */
export interface PublicAccount {
  id: number;
  username: string;
  role: AccountRole;
  locale: string;
}

/**
 * Strips private fields from an account.
 * @param account - Full account.
 */
export function toPublicAccount(account: Account): PublicAccount {
  return { id: account.id, username: account.username, role: account.role, locale: account.locale };
}

/** Returns the account loaded for this request, if any. */
export function currentAccount(res: Response): PublicAccount | undefined {
  return res.locals.account as PublicAccount | undefined;
}

/**
 * Creates the middleware loading the logged-in account. A session pointing to a
 * deleted or banned account is logged out.
 * @param accounts - Account repository.
 */
export function loadAccount(accounts: AccountRepository): RequestHandler {
  return (req, res, next) => {
    const id = req.session?.accountId;
    res.locals.account = undefined;
    if (id === undefined) {
      next();
      return;
    }
    const account = accounts.findById(id);
    if (!account || isBanned(account)) {
      req.session.destroy(() => next());
      return;
    }
    res.locals.account = toPublicAccount(account);
    next();
  };
}

/**
 * Creates a middleware for JSON APIs allowing only accounts holding at least
 * `role`; answers 401/403 with an error key instead of redirecting.
 * @param role - Minimum role.
 */
export function requireRoleApi(role: AccountRole): RequestHandler {
  return (_req, res, next) => {
    const account = currentAccount(res);
    if (!account) {
      res.status(401).json({ error: 'error.auth.not_authenticated' });
      return;
    }
    if (!hasRole(account.role, role)) {
      res.status(403).json({ error: 'error.http.forbidden' });
      return;
    }
    next();
  };
}

/** Redirects anonymous visitors to the login page, remembering where they wanted to go. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (currentAccount(res)) {
    next();
    return;
  }
  res.redirect(303, `/login?next=${encodeURIComponent(req.originalUrl)}`);
}

/**
 * Creates a middleware allowing only accounts holding at least `role`.
 * @param role - Minimum role.
 */
export function requireRole(role: AccountRole): RequestHandler {
  return (req, res, next) => {
    const account = currentAccount(res);
    if (!account) {
      requireAuth(req, res, next);
      return;
    }
    if (!hasRole(account.role, role)) {
      res.status(403).render('error', { code: 403, messageKey: 'error.http.forbidden' });
      return;
    }
    next();
  };
}

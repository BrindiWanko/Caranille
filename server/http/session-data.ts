/**
 * @file Declares the fields the engine stores in an HTTP session.
 * express-session exposes them as `req.session.<field>`; this augmentation types them.
 */
import 'express-session';

declare module 'express-session' {
  interface SessionData {
    /** Logged-in account id; absent for anonymous visitors. */
    accountId?: number;
    /** Interface language saved in the account, mirrored here to avoid a query per request. */
    locale?: string;
    /** Character chosen on the selection screen, used by the game socket. */
    characterId?: number;
    /** Anti-CSRF token embedded in every form of this session. */
    csrfToken?: string;
  }
}

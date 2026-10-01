/**
 * @file Builds the Express application: view engine, static files, sessions,
 * locale handling and page routes.
 *
 * Kept separate from `index.ts` so tests can create the app without opening a
 * network port. Socket.io is attached to the HTTP server in `net/socket.ts`.
 */
import { securityHeaders } from './http/security.js';
import { adminRouter } from './admin/admin-routes.js';
import express from 'express';
import type { Express } from 'express';
import { isLocale } from '../shared/i18n.js';
import { currentAccount, loadAccount, requireAuth, requireRole } from './auth/middleware.js';
import { editorRouter } from './admin/editor-routes.js';
import { authRouter } from './auth/routes.js';
import type { ServerContext } from './context.js';
import { characterRouter } from './game/character-routes.js';
import { safeRedirectPath } from './http/cookies.js';
import { exposeCsrf } from './http/csrf.js';
import { getDictionary, localeMiddleware, setLocaleCookie } from './i18n.js';
import { PATHS } from './paths.js';

/**
 * Creates the Express application.
 * @param ctx - Server context.
 */
export function createApp(ctx: ServerContext): Express {
  const app = express();
  app.disable('x-powered-by');
  if (ctx.config.trustProxy) app.set('trust proxy', 1);
  else {
    // Behind a proxy without TRUST_PROXY=1, every player seems to come from the proxy's
    // address: the login limiter would then lock everybody out at once.
    let warned = false;
    app.use((req, _res, next) => {
      if (!warned && req.headers['x-forwarded-for'] !== undefined) {
        warned = true;
        console.warn('[caranille] requests come through a proxy (X-Forwarded-For) but TRUST_PROXY is not set: set TRUST_PROXY=1');
      }
      next();
    });
  }
  app.use(securityHeaders(ctx.config.production));

  app.set('view engine', 'ejs');
  app.set('views', PATHS.views);

  // Static files. Generated/imported graphics keep the standard sheet folder layout under /img.
  const staticOptions = { maxAge: ctx.config.production ? '1d' : 0 };
  app.use('/build', express.static(`${PATHS.public}/build`, staticOptions));
  app.use('/img', express.static(`${PATHS.assets}/img`, staticOptions));
  app.use('/audio', express.static(PATHS.audio, staticOptions));
  // Uploaded files come from administrators, but are still served inert: no
  // scripts, no plugins, no content sniffing, even if opened directly.
  app.use('/uploads', express.static(PATHS.uploads, {
    ...staticOptions,
    setHeaders: (res) => {
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }));
  app.use(express.static(PATHS.public, staticOptions));

  // Dictionaries for the browser client (runtime language switch without reload).
  app.get('/locales/:locale.json', (req, res) => {
    const { locale } = req.params;
    if (!isLocale(locale)) {
      res.status(404).json({ error: 'error.http.not_found' });
      return;
    }
    res.json(getDictionary(locale));
  });

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  // Everything below needs the session (static files and health checks above do not).
  app.use(ctx.sessionMiddleware);
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(loadAccount(ctx.accounts));
  app.use(localeMiddleware);
  app.use(exposeCsrf);
  // The editor API parses its own (larger) JSON bodies.
  app.use('/api/editor', editorRouter(ctx));
  app.use('/api/admin', adminRouter(ctx));
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.locals.gameTitle = ctx.settings.get('gameTitle', 'Caranille');
    // Used by the language selector to come back to the same page.
    res.locals.currentPath = req.originalUrl;
    next();
  });

  // Language selector target: remembers the choice (cookie + account) and returns
  // to the previous page. Works without JavaScript; the client can also call it with fetch.
  app.get('/lang/:locale', (req, res) => {
    const { locale } = req.params;
    const next = safeRedirectPath(req.query.next);
    const account = currentAccount(res);
    if (isLocale(locale)) {
      setLocaleCookie(res, locale);
      if (account) {
        ctx.accounts.setLocale(account.id, locale);
        req.session.locale = locale;
      }
    }
    res.redirect(303, next);
  });

  app.get('/', (_req, res) => {
    res.render('index');
  });

  app.use(authRouter(ctx));

  // Resource manifest for the client and the editor.
  app.get('/api/resources', requireAuth, (_req, res) => {
    res.json({ tileSize: ctx.settings.get('tileSize', 48), resources: ctx.resources.all() });
  });

  // Visual check of every generated/imported resource (administrators only).
  app.get('/admin', requireRole('moderator'), (_req, res) => {
    res.render('admin');
  });

  app.get('/dev/assets', requireRole('admin'), (_req, res) => {
    const groups = new Map<string, ReturnType<typeof ctx.resources.all>>();
    for (const r of ctx.resources.all()) {
      if (!r.mime.startsWith('image/')) continue;
      groups.set(r.kind, [...(groups.get(r.kind) ?? []), r]);
    }
    res.render('dev-assets', { groups: [...groups] });
  });

  app.use(characterRouter(ctx));

  app.use((_req, res) => {
    res.status(404).render('error', { code: 404, messageKey: 'error.http.not_found' });
  });

  // Last-resort error handler: log the details, show a generic translated page.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[caranille] unhandled route error', err);
    if (res.headersSent) return;
    res.status(500).render('error', { code: 500, messageKey: 'error.http.server' });
  });

  return app;
}

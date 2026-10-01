/**
 * @file Character selection and creation pages, and the game page.
 *
 * Flow: /characters (list) -> /characters/new (creation form with live
 * preview) -> POST /characters -> back to the list -> POST
 * /characters/:id/play stores the chosen character in the session and opens
 * /game, where the client connects through socket.io.
 */
import { Router, type Request, type Response } from 'express';
import { HAIR_STYLES, OUTFITS } from '../../shared/art/character.js';
import { HAIR_RAMPS, OUTFIT_RAMPS, SKIN_RAMPS } from '../../shared/art/palette.js';
import { currentAccount, requireAuth } from '../auth/middleware.js';
import type { ServerContext } from '../context.js';
import { verifyCsrf } from '../http/csrf.js';

function field(req: Request, name: string): string {
  const value: unknown = (req.body as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : '';
}

/** Parses the appearance fields posted by the creation form. */
function appearanceFromForm(req: Request): Record<string, unknown> {
  const int = (name: string) => Number.parseInt(field(req, name), 10);
  return {
    body: field(req, 'body'),
    skin: int('skin'),
    hair: field(req, 'hair'),
    hairColor: int('hairColor'),
    outfitColor: int('outfitColor'),
  };
}

/**
 * Creates the router of character pages.
 * @param ctx - Server context.
 */
export function characterRouter(ctx: ServerContext): Router {
  const router = Router();
  router.use(['/characters', '/game'], requireAuth);

  const renderList = (res: Response, errorKey: string | null = null, status = 200) => {
    const account = currentAccount(res)!;
    res.status(status).render('characters', {
      characters: ctx.characterService.list(account.id),
      canCreate: ctx.characterService.canCreate(account.id),
      limit: ctx.characterService.limit,
      errorKey,
    });
  };

  const renderCreate = (res: Response, errorKey: string | null, values: Record<string, unknown>, status = 200) => {
    res.status(status).render('character-new', {
      classes: ctx.gameData.list('class'),
      palettes: {
        skin: SKIN_RAMPS.slice(0, 4).map((r) => r[2]),
        hair: HAIR_RAMPS.map((r) => r[2]),
        outfit: OUTFIT_RAMPS.map((r) => r[2]),
      },
      hairStyles: HAIR_STYLES,
      outfits: OUTFITS,
      errorKey,
      values,
    });
  };

  router.get('/characters', (_req, res) => renderList(res));

  router.get('/characters/new', (_req, res) => {
    if (!ctx.characterService.canCreate(currentAccount(res)!.id)) {
      renderList(res, 'error.character.limit_reached', 400);
      return;
    }
    renderCreate(res, null, {});
  });

  router.post('/characters', verifyCsrf, (req, res) => {
    const account = currentAccount(res)!;
    const values = { name: field(req, 'name'), classId: Number.parseInt(field(req, 'classId'), 10), ...appearanceFromForm(req) };
    const result = ctx.characterService.create(account.id, { name: values.name, classId: values.classId, appearance: values });
    if (!result.ok) {
      renderCreate(res, result.errorKey, values, 400);
      return;
    }
    res.redirect(303, '/characters');
  });

  router.post('/characters/:id/delete', verifyCsrf, (req, res) => {
    const id = Number(req.params.id);
    // A character in the world (another tab) is saved continuously: refuse.
    if (ctx.world.player(id)) {
      renderList(res, 'error.character.online', 409);
      return;
    }
    const error = ctx.characterService.delete(currentAccount(res)!.id, id, field(req, 'confirmName'), (c) => ctx.world.guilds.characterDeleted(c.id, c.name));
    if (error) {
      renderList(res, error, 400);
      return;
    }
    res.redirect(303, '/characters');
  });

  router.post('/characters/:id/play', verifyCsrf, (req, res) => {
    const character = ctx.characterService.owned(currentAccount(res)!.id, Number(req.params.id));
    if (!character) {
      renderList(res, 'error.character.not_found', 404);
      return;
    }
    req.session.characterId = character.id;
    req.session.save(() => res.redirect(303, '/game'));
  });

  router.get('/game', (req, res) => {
    const character = ctx.characterService.owned(currentAccount(res)!.id, req.session.characterId);
    if (!character) {
      res.redirect(303, '/characters');
      return;
    }
    res.render('game', { characterName: character.name });
  });

  return router;
}

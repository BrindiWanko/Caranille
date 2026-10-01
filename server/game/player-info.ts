/**
 * @file Builds the character data sent to its owner's client.
 */
import { expForLevel, paramAt, type ClassData } from '../../shared/database.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import type { PlayerCharacterInfo } from '../../shared/protocol.js';
import type { ServerContext } from '../context.js';
import type { Character } from '../db/characters.js';

/**
 * Experience bounds of a level, for the experience gauge.
 * @param cls - Class (experience curve).
 */
export function experienceRange(ctx: ServerContext, cls: ClassData | undefined, level: number): { xpFloor: number; xpNext: number } {
  if (!cls) return { xpFloor: 0, xpNext: 0 };
  const maxLevel = ctx.settings.get('maxLevel', DEFAULT_SETTINGS.maxLevel);
  return { xpFloor: expForLevel(cls, level), xpNext: level >= maxLevel ? 0 : expForLevel(cls, level + 1) };
}

/**
 * Converts a stored character into the payload sent to its owner.
 * @param ctx - Server context (for class data).
 * @param c - Character.
 */
export function playerInfo(ctx: ServerContext, c: Character): PlayerCharacterInfo {
  const cls = ctx.gameData.get('class', c.classId);
  return {
    ...experienceRange(ctx, cls, c.level),
    id: c.id,
    name: c.name,
    classId: c.classId,
    className: cls?.name ?? '?',
    level: c.level,
    xp: c.xp,
    hp: c.hp,
    mp: c.mp,
    maxHp: cls ? paramAt(cls.params.mhp, c.level) : c.hp,
    maxMp: cls ? paramAt(cls.params.mmp, c.level) : c.mp,
    gold: c.gold,
    appearance: c.appearance,
    mapId: c.mapId,
    x: c.x,
    y: c.y,
    direction: c.direction,
  };
}

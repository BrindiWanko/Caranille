/**
 * @file Character sheets shipped with the engine, in the standard layout
 * (4 × 2 characters per sheet, 3 × 4 frames each):
 * - `Actor1`: default look of the four starting classes (male / female);
 * - `People1`: village NPCs (villagers, merchant, guard, smith, innkeeper, sage);
 * - `Monster1`: slime, bat, wolf, goblin, skeleton, mushroom and variants;
 * - `$Boss1`: the raid boss (`$` = a single, larger character per sheet);
 * - `!Objects1`: animated objects (chests, flames, medicinal herb); `!` = no vertical offset;
 * - `faces/Actor1`, `faces/People1`: matching portraits (4 × 2 per sheet).
 */
import {
  assembleCharacterSheet,
  drawCharacterBlock,
  type CharacterAppearance,
} from '../../shared/art/character.js';
import { assembleFaceSheet, drawFace } from '../../shared/art/face.js';
import { RAMPS } from '../../shared/art/palette.js';
import type { GeneratedImage } from './build.js';
import { bat, chestAnimation, demonLord, flameAnimation, herbAnimation, mushroom, slime, wolf } from './monsters.js';

const actor = (a: Partial<CharacterAppearance>): CharacterAppearance => ({
  body: 'male', skin: 0, hair: 'short', hairColor: 1, outfit: 'warrior', outfitColor: 0, ...a,
});

/** Default appearances of the starting classes, reused by the class seed data. */
export const CLASS_APPEARANCES: CharacterAppearance[] = [
  actor({ outfit: 'warrior', hair: 'spiky', hairColor: 1, outfitColor: 0 }),
  actor({ outfit: 'warrior', body: 'female', hair: 'ponytail', hairColor: 3, outfitColor: 0 }),
  actor({ outfit: 'mage', hair: 'short', hairColor: 5, outfitColor: 1, skin: 1 }),
  actor({ outfit: 'mage', body: 'female', hair: 'long', hairColor: 7, outfitColor: 3 }),
  actor({ outfit: 'archer', hair: 'short', hairColor: 2, outfitColor: 2 }),
  actor({ outfit: 'archer', body: 'female', hair: 'bun', hairColor: 1, outfitColor: 2, skin: 2 }),
  actor({ outfit: 'priest', hair: 'short', hairColor: 1, outfitColor: 7 }),
  actor({ outfit: 'priest', body: 'female', hair: 'long', hairColor: 2, outfitColor: 1 }),
];

const PEOPLE: CharacterAppearance[] = [
  actor({ outfit: 'villager', hair: 'short', hairColor: 1, outfitColor: 4 }),
  actor({ outfit: 'villager', body: 'female', hair: 'long', hairColor: 3, outfitColor: 2 }),
  actor({ outfit: 'merchant', hair: 'short', hairColor: 0, outfitColor: 7, beard: true, skin: 1 }),
  actor({ outfit: 'guard', outfitColor: 1 }),
  actor({ outfit: 'smith', hair: 'bald', hairColor: 3, outfitColor: 5, beard: true, skin: 2 }),
  actor({ outfit: 'innkeeper', body: 'female', hair: 'bun', hairColor: 1, outfitColor: 0 }),
  actor({ outfit: 'sage', hair: 'bald', hairColor: 4, beard: true, outfitColor: 3 }),
  actor({ outfit: 'villager', body: 'female', hair: 'ponytail', hairColor: 2, outfitColor: 6, skin: 3 }),
];

/** Returns every generated character sheet. */
export function characterSheets(): GeneratedImage[] {
  const goblin = drawCharacterBlock(actor({ outfit: 'goblin', hair: 'bald' }));
  const skeleton = drawCharacterBlock(actor({ outfit: 'skeleton', hair: 'bald' }));
  return [
    { path: 'characters/Actor1', canvas: assembleCharacterSheet(CLASS_APPEARANCES.map(drawCharacterBlock)) },
    { path: 'faces/Actor1', canvas: assembleFaceSheet(CLASS_APPEARANCES.map(drawFace)) },
    { path: 'faces/People1', canvas: assembleFaceSheet(PEOPLE.map(drawFace)) },
    { path: 'characters/People1', canvas: assembleCharacterSheet(PEOPLE.map(drawCharacterBlock)) },
    {
      path: 'characters/Monster1',
      canvas: assembleCharacterSheet([slime(), bat(), wolf(), goblin, skeleton, mushroom(), slime(RAMPS.roofRed), bat(RAMPS.roofBrown)]),
    },
    { path: 'characters/$Boss1', canvas: demonLord() },
    {
      path: 'characters/!Objects1',
      canvas: assembleCharacterSheet([chestAnimation(), chestAnimation(RAMPS.roofRed), flameAnimation(), flameAnimation(), herbAnimation()]),
    },
  ];
}

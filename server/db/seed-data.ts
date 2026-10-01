/**
 * @file Default content written into a brand-new database: the four starting
 * classes, and a small set of skills, items, equipment, enemies and states
 * used by the demo. Names and descriptions are ordinary game content that the
 * creator can rewrite in the editor, in any language.
 */
import type { CharacterAppearance } from '../../shared/art/character.js';
import { defaultRecord } from '../../shared/database-schema.js';
import {
  type RaidData,
  noDamage,
  zeroParams,
  type ArmorData,
  type QuestData,
  type ClassData,
  type EnemyData,
  type ItemData,
  type ParamCurve,
  type ParamName,
  type ParamValues,
  type SkillData,
  type StateData,
  type WeaponData,
} from '../../shared/database.js';
import { iconIndex } from '../../shared/icons.js';
import { DEMO_EVENTS, DEMO_MAPS } from './demo-map.js';

const curve = (base: number, growth: number): ParamCurve => ({ base, growth });

function params(values: Record<ParamName, [number, number]>): Record<ParamName, ParamCurve> {
  return Object.fromEntries(Object.entries(values).map(([k, [b, g]]) => [k, curve(b, g)])) as Record<ParamName, ParamCurve>;
}

const look = (a: Partial<CharacterAppearance>): CharacterAppearance => ({
  body: 'male', skin: 0, hair: 'short', hairColor: 1, outfit: 'warrior', outfitColor: 0, ...a,
});

const flat = (p: Partial<ParamValues>): ParamValues => ({ ...zeroParams(), ...p });

/** The four starting classes. */
export const DEFAULT_CLASSES: ClassData[] = [
  {
    id: 1,
    name: 'Guerrier',
    description: 'Combattant robuste au corps à corps, maître de l’épée et du bouclier.',
    outfit: 'warrior',
    defaultAppearance: look({ outfit: 'warrior', hair: 'spiky', hairColor: 1, outfitColor: 0 }),
    icon: iconIndex('sword'),
    params: params({ mhp: [120, 18], mmp: [20, 2], atk: [16, 3], def: [14, 3], mat: [6, 1], mdf: [8, 1.5], agi: [10, 1.5], luk: [8, 1] }),
    expBase: 30,
    expGrowth: 25,
    learnings: [{ level: 1, skillId: 1 }, { level: 5, skillId: 2 }],
    weaponTypes: [1, 2, 3, 7],
    armorTypes: [1, 2, 3, 4, 5],
    traits: [],
  },
  {
    id: 2,
    name: 'Mage',
    description: 'Lanceur de sorts élémentaires dévastateurs, fragile mais redoutable à distance.',
    outfit: 'mage',
    defaultAppearance: look({ outfit: 'mage', hair: 'short', hairColor: 5, outfitColor: 1, skin: 1 }),
    icon: iconIndex('staff'),
    params: params({ mhp: [70, 9], mmp: [60, 8], atk: [6, 1], def: [7, 1], mat: [18, 3.5], mdf: [14, 2.5], agi: [11, 1.5], luk: [10, 1] }),
    expBase: 30,
    expGrowth: 25,
    learnings: [{ level: 1, skillId: 3 }, { level: 4, skillId: 4 }],
    weaponTypes: [5, 6],
    armorTypes: [1, 5],
    traits: [],
  },
  {
    id: 3,
    name: 'Archer',
    description: 'Tireur agile qui frappe de loin et esquive les coups.',
    outfit: 'archer',
    defaultAppearance: look({ outfit: 'archer', hair: 'short', hairColor: 2, outfitColor: 2 }),
    icon: iconIndex('bow'),
    params: params({ mhp: [90, 12], mmp: [30, 3], atk: [14, 2.5], def: [9, 1.5], mat: [8, 1], mdf: [9, 1.5], agi: [16, 3], luk: [12, 1.5] }),
    expBase: 30,
    expGrowth: 25,
    learnings: [{ level: 1, skillId: 5 }],
    weaponTypes: [4, 6],
    armorTypes: [1, 2, 5],
    traits: [{ kind: 'evasion', target: '', value: 0.05 }],
  },
  {
    id: 4,
    name: 'Prêtre',
    description: 'Soigneur dévoué qui protège ses alliés grâce à la magie sacrée.',
    outfit: 'priest',
    defaultAppearance: look({ outfit: 'priest', hair: 'short', hairColor: 1, outfitColor: 7 }),
    icon: iconIndex('holy'),
    params: params({ mhp: [85, 11], mmp: [50, 7], atk: [8, 1.5], def: [10, 2], mat: [14, 2.5], mdf: [16, 3], agi: [9, 1], luk: [12, 1.5] }),
    expBase: 30,
    expGrowth: 25,
    learnings: [{ level: 1, skillId: 6 }],
    weaponTypes: [5, 7],
    armorTypes: [1, 2, 5],
    traits: [],
  },
];

const skill = (s: Partial<SkillData> & Pick<SkillData, 'id' | 'name'>): SkillData => ({ ...defaultRecord('skill', s.id), ...s });

/** Default skills. */
export const DEFAULT_SKILLS: SkillData[] = [
  skill({ id: 1, name: 'Coup puissant', description: 'Une frappe appuyée au corps à corps.', icon: iconIndex('slash'), mpCost: 3, cooldown: 4, range: 1, scope: 'enemy', damage: { ...noDamage(), type: 'hp_damage', formula: 'a.atk * 5 - b.def * 2', element: 1, critical: true }, message: '' }),
  skill({ id: 2, name: 'Cri de guerre', description: 'Augmente l’attaque pour un moment.', icon: iconIndex('sword_up'), mpCost: 6, cooldown: 30, range: 0, scope: 'self', damage: noDamage(), effects: [{ kind: 'add_state', value: 3, percent: 100 }] }),
  skill({ id: 3, name: 'Boule de feu', description: 'Projette une boule de flammes.', icon: iconIndex('fire'), mpCost: 5, cooldown: 2, range: 5, scope: 'enemy', damage: { ...noDamage(), type: 'hp_damage', formula: 'a.mat * 4 - b.mdf * 2', element: 2 } }),
  skill({ id: 4, name: 'Éclair de givre', description: 'Un trait de glace qui ralentit.', icon: iconIndex('ice'), mpCost: 7, cooldown: 4, range: 5, scope: 'enemy', damage: { ...noDamage(), type: 'hp_damage', formula: 'a.mat * 4 - b.mdf * 2', element: 3 } }),
  skill({ id: 5, name: 'Tir précis', description: 'Une flèche qui vise les points faibles.', icon: iconIndex('arrow'), mpCost: 3, cooldown: 3, range: 6, scope: 'enemy', damage: { ...noDamage(), type: 'hp_damage', formula: 'a.atk * 4 + a.agi - b.def * 2', element: 1, critical: true } }),
  skill({ id: 6, name: 'Soin', description: 'Restaure les PV d’un allié.', icon: iconIndex('heal'), mpCost: 5, cooldown: 2, range: 5, scope: 'ally', damage: { ...noDamage(), type: 'hp_recover', formula: 'a.mat * 3 + 20', element: 8 } }),
];

const item = (i: Partial<ItemData> & Pick<ItemData, 'id' | 'name'>): ItemData => ({ ...defaultRecord('item', i.id), ...i });

/** Default items. */
export const DEFAULT_ITEMS: ItemData[] = [
  item({ id: 1, name: 'Potion', description: 'Restaure 50 PV.', icon: iconIndex('potion_red'), price: 30, effects: [{ kind: 'recover_hp', value: 50, percent: 0 }] }),
  item({ id: 2, name: 'Éther', description: 'Restaure 30 PM.', icon: iconIndex('potion_blue'), price: 60, effects: [{ kind: 'recover_mp', value: 30, percent: 0 }] }),
  item({ id: 3, name: 'Élixir', description: 'Restaure tous les PV et PM.', icon: iconIndex('elixir'), price: 500, effects: [{ kind: 'recover_hp', value: 0, percent: 100 }, { kind: 'recover_mp', value: 0, percent: 100 }] }),
  item({ id: 4, name: 'Herbe médicinale', description: 'Guérit le poison.', icon: iconIndex('herb'), price: 15, effects: [{ kind: 'remove_state', value: 1, percent: 100 }] }),
  item({ id: 5, name: 'Pain', description: 'Restaure 20 PV.', icon: iconIndex('bread'), price: 5, effects: [{ kind: 'recover_hp', value: 20, percent: 0 }] }),
  item({ id: 6, name: 'Clé rouillée', description: 'Une vieille clé. Que peut-elle ouvrir ?', icon: iconIndex('key'), kind: 'key', consumable: false, maxStack: 1, occasion: 'never', price: 0 }),
];

const weapon = (w: Partial<WeaponData> & Pick<WeaponData, 'id' | 'name'>): WeaponData => ({ ...defaultRecord('weapon', w.id), ...w });

/** Default weapons. */
export const DEFAULT_WEAPONS: WeaponData[] = [
  weapon({ id: 1, name: 'Épée courte', description: 'Une lame simple mais fiable.', icon: iconIndex('sword'), weaponType: 1, price: 100, params: flat({ atk: 8 }) }),
  weapon({ id: 2, name: 'Bâton de chêne', description: 'Canalise la magie.', icon: iconIndex('staff'), weaponType: 5, price: 90, params: flat({ atk: 2, mat: 8 }), range: 1 }),
  weapon({ id: 3, name: 'Arc court', description: 'Tire à distance.', icon: iconIndex('bow'), weaponType: 4, price: 110, params: flat({ atk: 7, agi: 2 }), range: 5 }),
  weapon({ id: 4, name: 'Masse bénie', description: 'Une masse consacrée.', icon: iconIndex('mace'), weaponType: 7, price: 120, params: flat({ atk: 6, mdf: 3 }) }),
];

const armor = (a: Partial<ArmorData> & Pick<ArmorData, 'id' | 'name'>): ArmorData => ({ ...defaultRecord('armor', a.id), ...a });

/** Default armors. */
export const DEFAULT_ARMORS: ArmorData[] = [
  armor({ id: 1, name: 'Tunique de cuir', description: 'Protection légère.', icon: iconIndex('armor'), armorType: 2, slot: 'body', price: 80, params: flat({ def: 5 }) }),
  armor({ id: 2, name: 'Robe d’apprenti', description: 'Tissée de fils enchantés.', icon: iconIndex('robe'), armorType: 1, slot: 'body', price: 80, params: flat({ def: 2, mdf: 5 }) }),
  armor({ id: 3, name: 'Bouclier en bois', description: 'Arrête les coups les moins forts.', icon: iconIndex('shield'), armorType: 4, slot: 'shield', price: 60, params: flat({ def: 4 }) }),
  armor({ id: 4, name: 'Casque de fer', description: 'Protège la tête.', icon: iconIndex('helmet'), armorType: 3, slot: 'head', price: 90, params: flat({ def: 4 }) }),
  armor({ id: 5, name: 'Anneau de vigueur', description: 'Augmente les PV maximum.', icon: iconIndex('ring'), armorType: 5, slot: 'accessory', price: 200, params: flat({ mhp: 30 }) }),
];

const enemy = (e: Partial<EnemyData> & Pick<EnemyData, 'id' | 'name'>): EnemyData => ({ ...defaultRecord('enemy', e.id), ...e });

/** Default enemies (sprites of the Monster1 sheet). */
export const DEFAULT_ENEMIES: EnemyData[] = [
  enemy({ id: 1, name: 'Slime bleu', characterName: 'Monster1', characterIndex: 0, params: flat({ mhp: 40, atk: 8, def: 4, mat: 2, mdf: 4, agi: 5, luk: 5 }), exp: 8, gold: 5, drops: [{ kind: 'item', id: 1, chance: 30 }], ai: 'passive' }),
  enemy({ id: 2, name: 'Chauve-souris', characterName: 'Monster1', characterIndex: 1, params: flat({ mhp: 30, atk: 10, def: 3, agi: 14, luk: 8 }), exp: 10, gold: 6, drops: [{ kind: 'item', id: 5, chance: 20 }] }),
  enemy({ id: 3, name: 'Loup gris', characterName: 'Monster1', characterIndex: 2, params: flat({ mhp: 70, atk: 16, def: 7, agi: 12, luk: 6 }), exp: 20, gold: 12, drops: [{ kind: 'item', id: 1, chance: 25 }] }),
  enemy({ id: 4, name: 'Gobelin', characterName: 'Monster1', characterIndex: 3, params: flat({ mhp: 90, atk: 18, def: 10, agi: 9, luk: 7 }), exp: 28, gold: 20, drops: [{ kind: 'weapon', id: 1, chance: 5 }, { kind: 'item', id: 2, chance: 15 }] }),
  enemy({ id: 5, name: 'Squelette', characterName: 'Monster1', characterIndex: 4, params: flat({ mhp: 110, atk: 22, def: 14, mdf: 2, agi: 8, luk: 5 }), exp: 36, gold: 25, drops: [{ kind: 'armor', id: 4, chance: 5 }] }),
  enemy({ id: 6, name: 'Champignon furieux', characterName: 'Monster1', characterIndex: 5, params: flat({ mhp: 60, atk: 12, def: 8, mat: 10, agi: 6 }), exp: 15, gold: 9, drops: [{ kind: 'item', id: 4, chance: 30 }], ai: 'passive' }),
  enemy({ id: 8, name: 'Roi gobelin', characterName: 'Monster1', characterIndex: 3, params: flat({ mhp: 600, mmp: 50, atk: 26, def: 14, mat: 10, mdf: 10, agi: 10, luk: 10 }), exp: 150, gold: 100, drops: [], aggroRadius: 4, respawn: 3600 }),
  enemy({ id: 7, name: 'Seigneur démon', characterName: '$Boss1', characterIndex: 0, params: flat({ mhp: 5000, mmp: 500, atk: 60, def: 40, mat: 60, mdf: 40, agi: 20, luk: 20 }), exp: 2000, gold: 1500, drops: [{ kind: 'item', id: 3, chance: 100 }], respawn: 3600, moveSpeed: 3 }),
];

const state = (s: Partial<StateData> & Pick<StateData, 'id' | 'name'>): StateData => ({ ...defaultRecord('state', s.id), ...s });

/** Default states. */
export const DEFAULT_STATES: StateData[] = [
  state({ id: 1, name: 'Poison', icon: iconIndex('poison'), duration: 20, hpPerSecond: -2, message: 'est empoisonné !' }),
  state({ id: 2, name: 'Étourdissement', icon: iconIndex('stun'), duration: 3, restriction: 'cannot_both', removeOnDamage: true, message: 'est étourdi !' }),
  state({ id: 3, name: 'Force accrue', icon: iconIndex('atk_up'), duration: 30, traits: [{ kind: 'param_rate', target: 'atk', value: 1.25 }], message: 'se sent plus fort !' }),
  state({ id: 4, name: 'Régénération', icon: iconIndex('regen'), duration: 15, hpPerSecond: 2, message: 'se régénère.' }),
];

const quest = (q: Partial<QuestData> & { id: number }): QuestData => ({ ...defaultRecord('quest', q.id), ...q });

/** Default raid: the Goblin King in the instanced cave north of the forest. */
export const DEFAULT_RAIDS: RaidData[] = [
  {
    ...defaultRecord('raid', 1),
    name: 'Le repaire du roi gobelin',
    description: 'Au fond de la grotte de Bruyère, le roi gobelin rassemble ses troupes. Chaque groupe l’affronte dans sa propre copie de la grotte.',
    mapId: DEMO_MAPS.dungeon,
    bossEnemyId: 8,
    minLevel: 1,
    minPlayers: 1,
    maxPlayers: 5,
    lockout: 'weekly',
    lootMode: 'round_robin',
    rewardGold: 150,
    rewardExp: 120,
    rewardItems: [
      { kind: 'armor', item: 1, weapon: 1, armor: 4, count: 1 },
      { kind: 'item', item: 3, weapon: 1, armor: 1, count: 1 },
    ],
    phases: [
      { hpBelow: 75, mechanic: 'adds', enemyId: 4, count: 2, damage: 1, radius: 0, interval: 0 },
      { hpBelow: 50, mechanic: 'zone', enemyId: 1, count: 1, damage: 30, radius: 1, interval: 6 },
      { hpBelow: 25, mechanic: 'enrage', enemyId: 1, count: 1, damage: 1, radius: 0, interval: 0 },
    ],
  },
];
type ObjectiveInput = Partial<QuestData['steps'][number]['objectives'][number]> & Pick<QuestData['steps'][number]['objectives'][number], 'kind'>;
const objective = (o: ObjectiveInput) => ({ mapId: 1, eventId: 1, enemyId: 1, itemId: 1, switchId: 1, x: 0, y: 0, radius: 0, count: 1, label: '', ...o });
const CHAPTER_1 = 'Chapitre 1 — L’éveil de la forêt';

/**
 * Default quests: Lina's box (driven by event commands only) and the two
 * quests of the first chapter of the demo, which use steps and objectives
 * tracked by the server.
 */
export const DEFAULT_QUESTS: QuestData[] = [
  quest({ id: 1, name: 'Le coffret de Lina', icon: iconIndex('quests'), category: 'Village de Caranille', description: 'Lina a égaré son petit coffret rouge près de l’étang du village.' }),
  quest({
    id: 2,
    name: 'Des herbes pour le sage',
    icon: iconIndex('herb'),
    category: CHAPTER_1,
    description: 'Le vieux sage du village a besoin d’herbes médicinales pour préparer ses remèdes.',
    takeItems: true,
    steps: [
      { description: 'Demandez au garde du village où poussent les herbes.', objectives: [objective({ kind: 'talk', mapId: DEMO_MAPS.village, eventId: DEMO_EVENTS.guard })] },
      { description: 'Rendez-vous dans la forêt de Bruyère, au nord du village.', objectives: [objective({ kind: 'reach', mapId: DEMO_MAPS.forest, x: 14, y: 25, radius: 4 })] },
      { description: 'Cueillez deux herbes médicinales dans la forêt.', objectives: [objective({ kind: 'collect', itemId: 4, count: 2 })] },
    ],
    rewardGold: 80,
    rewardExp: 60,
    rewardItems: [{ kind: 'item', item: 1, weapon: 1, armor: 1, count: 2 }],
  }),
  quest({
    id: 3,
    name: 'La terre gronde',
    icon: iconIndex('info'),
    category: CHAPTER_1,
    description: 'Le sage s’inquiète des grondements venus de la forêt. Borin le bûcheron en sait peut-être plus.',
    prerequisite: 2,
    autoComplete: true,
    steps: [
      { description: 'Trouvez Borin le bûcheron dans la clairière de la forêt.', objectives: [objective({ kind: 'talk', mapId: DEMO_MAPS.forest, eventId: DEMO_EVENTS.borin })] },
      { description: 'Rapportez ce que vous avez vu au vieux sage.', objectives: [objective({ kind: 'talk', mapId: DEMO_MAPS.village, eventId: DEMO_EVENTS.sage, label: 'Prévenir le vieux sage' })] },
    ],
    rewardGold: 50,
    rewardExp: 80,
    rewardItems: [{ kind: 'item', item: 3, weapon: 1, armor: 1, count: 1 }],
  }),
  quest({
    id: 4,
    name: 'Les nuisibles de la clairière',
    icon: iconIndex('slash'),
    category: CHAPTER_1,
    description: 'Des slimes ont envahi la clairière de la forêt depuis le tremblement de terre. Borin aimerait qu’on l’en débarrasse.',
    prerequisite: 3,
    steps: [{ description: 'Battez trois slimes bleus dans la clairière.', objectives: [objective({ kind: 'kill', enemyId: 1, count: 3 })] }],
    rewardGold: 60,
    rewardExp: 50,
    rewardItems: [{ kind: 'armor', item: 1, weapon: 1, armor: 1, count: 1 }],
  }),
];

/**
 * @file Demo maps written into a fresh database: the starting village
 * (cliffs, woods, houses, pond, plaza with a well, villagers to talk to), the
 * forest north of it and the interior of the first house, linked by
 * teleporters. They are ordinary map content that the creator can edit or
 * delete in the editor; their texts are sample content.
 *
 * Tile ids refer to the default "Outside" and "Inside" tileset layouts.
 */
import { refreshAllAutotiles } from '../../shared/autotile-shapes.js';
import { BranchType, Cmd, MmoCmd, Priority, QuestStatus, RouteCmd, Trigger, createPage, emptyConditions, textCommands, type EventCommand, type EventConditions, type GameEvent } from '../../shared/events.js';
import { REGION_LAYER, createMap, setTileAt, tileAt, type MapData } from '../../shared/map.js';
import { TILE_ID_A1, TILE_ID_A2, TILE_ID_A3, TILE_ID_A4, plainTileId } from '../../shared/tiles.js';

const a1 = (kind: number) => TILE_ID_A1 + kind * 48;
const a2 = (col: number, row: number) => TILE_ID_A2 + (row * 8 + col) * 48;
const a3 = (col: number, row: number) => TILE_ID_A3 + (row * 8 + col) * 48;
const a4Top = (col: number) => TILE_ID_A4 + col * 48;
const a4Side = (col: number) => TILE_ID_A4 + (8 + col) * 48;
const B = (col: number, row: number) => plainTileId(0, col, row);
const C = (col: number, row: number) => plainTileId(1, col, row);

/** Small painting helper over a map. */
class Painter {
  constructor(readonly map: MapData) {}

  rect(x0: number, y0: number, x1: number, y1: number, z: number, id: number): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setTileAt(this.map, x, y, z, id);
  }

  /** Places a multi-tile object from a B–E sheet (top-left source cell). */
  object(x: number, y: number, z: number, src: (c: number, r: number) => number, col: number, row: number, w = 1, h = 1): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setTileAt(this.map, x + i, y + j, z, src(col + i, row + j));
  }

  /** Tells whether an area is free of objects on the object layers. */
  free(x0: number, y0: number, x1: number, y1: number): boolean {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (tileAt(this.map, x, y, 1) !== 0 || tileAt(this.map, x, y, 2) !== 0 || tileAt(this.map, x, y, 3) !== 0) return false;
        const ground = tileAt(this.map, x, y, 0);
        if (ground !== a2(0, 0)) return false;
      }
    }
    return true;
  }

  /** A house: roof rows over wall rows, with a door and windows. */
  house(x: number, y: number, w: number, roof: number, wall: number, door: number, sign?: number): void {
    this.rect(x, y, x + w - 1, y + 2, 0, roof);
    this.rect(x, y + 3, x + w - 1, y + 4, 0, wall);
    const doorX = x + Math.floor(w / 2);
    setTileAt(this.map, doorX, y + 4, 2, door);
    setTileAt(this.map, x + 1, y + 3, 2, C(2, 0));
    setTileAt(this.map, x + w - 2, y + 3, 2, C(2, 0));
    if (sign !== undefined) setTileAt(this.map, doorX - 1, y + 3, 3, sign);
    setTileAt(this.map, x + w - 2, y - 1, 3, C(4, 0)); // chimney peeking above the roof
  }
}

let nextEventId = 1;
function npc(name: string, x: number, y: number, sheet: string, index: number, face: [string, number], speaker: string, lines: string[][], direction: 2 | 4 | 6 | 8 = 2): GameEvent {
  const list = lines.flatMap((block) => textCommands(block, face, speaker));
  list.push({ code: 0, indent: 0, parameters: [] });
  return {
    id: nextEventId++,
    name,
    note: '',
    x,
    y,
    pages: [createPage({ image: { tileId: 0, characterName: sheet, characterIndex: index, direction, pattern: 1 }, trigger: Trigger.Action, list })],
  };
}

/** Map ids of the demo maps. */
export const DEMO_MAPS = { village: 1, forest: 2, house: 3, dungeon: 4 } as const;

/** Ids of the demo events used by the chapter 1 quests (checked by the tests). */
export const DEMO_EVENTS = { guard: 3, sage: 4, borin: 1 } as const;

/**
 * An invisible teleporter: walking onto it transfers the player.
 * @param to - Destination map, cell and facing.
 */
function teleporter(name: string, x: number, y: number, to: { mapId: number; x: number; y: number; direction: 2 | 4 | 6 | 8 }): GameEvent {
  return {
    id: nextEventId++,
    name,
    note: '',
    x,
    y,
    pages: [
      createPage({
        priorityType: Priority.Below,
        trigger: Trigger.PlayerTouch,
        list: [
          { code: Cmd.TransferPlayer, indent: 0, parameters: [0, to.mapId, to.x, to.y, to.direction, 0] },
          { code: Cmd.End, indent: 0, parameters: [] },
        ],
      }),
    ],
  };
}

const c = (code: number, parameters: unknown[] = [], indent = 0): EventCommand => ({ code, indent, parameters });
const end = (indent = 0): EventCommand => c(Cmd.End, [], indent);
const say = (speaker: string, face: [string, number], lines: string[], indent = 0): EventCommand[] => textCommands(lines, face, speaker, indent);
const when = (conditions: Partial<EventConditions>): EventConditions => ({ ...emptyConditions(), ...conditions });
const LINA: [string, number] = ['People1', 1];

/**
 * Lina and her lost box: the demo of personal story progress. Her dialogue
 * depends on the quest status of each player, and the box only appears to
 * players who accepted the quest.
 */
function linaEvents(): GameEvent[] {
  const lina: GameEvent = {
    id: nextEventId++,
    name: 'Lina',
    note: 'Quête 1 : le coffret de Lina.',
    x: 26,
    y: 17,
    pages: [
      createPage({
        image: { tileId: 0, characterName: 'People1', characterIndex: 1, direction: 2, pattern: 1 },
        list: [
          ...say('Lina', LINA, ['Oh… j’ai égaré mon petit coffret rouge près de l’étang.', 'Tu voudrais bien m’aider à le retrouver ?']),
          c(Cmd.ShowChoices, [['Bien sûr !', 'Pas maintenant'], 1, 0, 2, 0]),
          c(Cmd.When, [0, 'Bien sûr !']),
          c(MmoCmd.StartQuest, [1], 1),
          ...say('Lina', LINA, ['Merci ! Il doit être quelque part au sud de l’étang.'], 1),
          end(1),
          c(Cmd.When, [1, 'Pas maintenant']),
          ...say('Lina', LINA, ['Tant pis… Reviens me voir si tu changes d’avis.'], 1),
          end(1),
          c(Cmd.ChoicesEnd),
          end(),
        ],
      }),
      createPage({
        conditions: when({ questValid: true, questId: 1, questStatus: QuestStatus.InProgress }),
        image: { tileId: 0, characterName: 'People1', characterIndex: 1, direction: 2, pattern: 1 },
        list: [...say('Lina', LINA, ['Tu as trouvé mon coffret ?', 'Il doit être au sud de l’étang…']), end()],
      }),
      createPage({
        conditions: when({ switch1Valid: true, switch1Id: 1, questValid: true, questId: 1, questStatus: QuestStatus.InProgress }),
        image: { tileId: 0, characterName: 'People1', characterIndex: 1, direction: 2, pattern: 1 },
        list: [
          ...say('Lina', LINA, ['Mon coffret ! Merci infiniment, \\P !', 'Tiens, prends ceci pour ta peine.']),
          c(Cmd.ChangeGold, [0, 0, 50]),
          c(MmoCmd.CompleteQuest, [1]),
          end(),
        ],
      }),
      createPage({
        conditions: when({ questValid: true, questId: 1, questStatus: QuestStatus.Completed }),
        image: { tileId: 0, characterName: 'People1', characterIndex: 1, direction: 2, pattern: 1 },
        list: [...say('Lina', LINA, ['Merci encore pour mon coffret, \\P !', 'Je ne m’en séparerai plus jamais.']), end()],
      }),
    ],
  };
  const box: GameEvent = {
    id: nextEventId++,
    name: 'Coffret de Lina',
    note: 'Visible seulement pendant la quête 1, tant que l’interrupteur 1 est OFF.',
    x: 32,
    y: 26,
    pages: [
      createPage({ priorityType: Priority.Below, through: true }),
      createPage({
        conditions: when({ questValid: true, questId: 1, questStatus: QuestStatus.InProgress }),
        image: { tileId: 0, characterName: '!Objects1', characterIndex: 1, direction: 2, pattern: 1 },
        directionFix: true,
        list: [
          c(Cmd.ShowBalloon, [-1, 1, true]),
          ...textCommands(['Un petit coffret rouge… c’est celui de Lina !']),
          c(Cmd.ControlSwitches, [1, 1, 0]),
          c(MmoCmd.AdvanceQuest, [1, 0]),
          end(),
        ],
      }),
      createPage({ conditions: when({ switch1Valid: true, switch1Id: 1 }), priorityType: Priority.Below, through: true }),
    ],
  };
  return [lina, box];
}

const SAGE: [string, number] = ['People1', 6];
const GUARD: [string, number] = ['People1', 3];
const BORIN: [string, number] = ['People1', 4];
const person = (index: number, direction: 2 | 4 | 6 | 8 = 2) => ({ tileId: 0, characterName: 'People1', characterIndex: index, direction, pattern: 1 });
const questIs = (questId: number, questStatus: number, questStep = 0) => when({ questValid: true, questId, questStatus, questStep });

/**
 * The village sage: gives both quests of chapter 1 and receives them. Each
 * page matches one moment of the chapter (the last page whose conditions
 * hold is shown), so the dialogue follows each player's own progress.
 */
function sageEvent(): GameEvent {
  const offer = (questId: number, lines: string[], accepted: string[]): EventCommand[] => [
    ...say('Vieux sage', SAGE, lines),
    c(Cmd.ShowChoices, [['J’y vais !', 'Plus tard'], 1, 0, 2, 0]),
    c(Cmd.When, [0, 'J’y vais !']),
    c(MmoCmd.StartQuest, [questId], 1),
    ...say('Vieux sage', SAGE, accepted, 1),
    end(1),
    c(Cmd.When, [1, 'Plus tard']),
    ...say('Vieux sage', SAGE, ['Reviens me voir quand tu seras prêt.'], 1),
    end(1),
    c(Cmd.ChoicesEnd),
  ];
  return {
    id: nextEventId++,
    name: 'Sage',
    note: 'Chapitre 1 : donne et reçoit les quêtes 2 et 3.',
    x: 12,
    y: 11,
    pages: [
      createPage({
        image: person(6),
        list: [
          ...say('Vieux sage', SAGE, ['Ah, un nouveau visage…', 'Appuie sur \\C[6]Action\\C[0] pour parler aux gens,', 'et sur \\C[6]Annuler\\C[0] pour ouvrir le menu.']),
          ...offer(2, ['Dis-moi, aurais-tu un moment pour aider un vieil homme ?', 'Il me faut des herbes médicinales pour mes remèdes.'], ['Merci ! Le garde, au sud du village,', 'sait où elles poussent.']),
          end(),
        ],
      }),
      createPage({
        conditions: questIs(2, QuestStatus.InProgress),
        image: person(6),
        list: [...say('Vieux sage', SAGE, ['Le garde Aldric, au sud du village,', 'connaît la forêt mieux que personne.']), end()],
      }),
      createPage({
        conditions: questIs(2, QuestStatus.Ready),
        image: person(6),
        list: [
          ...say('Vieux sage', SAGE, ['De belles herbes bien fraîches !', 'Merci, \\P. Tiens, prends ceci pour ta peine.']),
          c(MmoCmd.CompleteQuest, [2]),
          end(),
        ],
      }),
      createPage({
        conditions: questIs(2, QuestStatus.Completed),
        image: person(6),
        list: [
          ...offer(3, ['Depuis quelques jours, la terre gronde du côté de la forêt…', 'Borin le bûcheron vit dans la clairière. Il sait peut-être quelque chose.'], ['Sois prudent, \\P.', 'La clairière est au bout du chemin de la forêt.']),
          end(),
        ],
      }),
      createPage({
        conditions: questIs(3, QuestStatus.InProgress),
        image: person(6),
        list: [...say('Vieux sage', SAGE, ['Borin vit dans la clairière, au nord de la forêt.']), end()],
      }),
      createPage({
        conditions: questIs(3, QuestStatus.InProgress, 1),
        image: person(6),
        list: [...say('Vieux sage', SAGE, ['Des ombres qui s’éveillent… Voilà qui est inquiétant.', 'Merci de m’avoir prévenu, \\P. Le village te doit beaucoup.']), end()],
      }),
      createPage({
        conditions: questIs(3, QuestStatus.Completed),
        image: person(6),
        list: [...say('Vieux sage', SAGE, ['Repose-toi, \\P. Tes aventures ne font que commencer.']), end()],
      }),
    ],
  };
}

/** The village guard: tells players on quest 2 where the herbs grow. */
function guardEvent(): GameEvent {
  return {
    id: nextEventId++,
    name: 'Garde',
    note: 'Quête 2, étape 1 : parler au garde.',
    x: 21,
    y: 27,
    pages: [
      createPage({ image: person(3, 8), list: [...say('Garde Aldric', GUARD, ['Halte ! Au-delà de ce point, les routes du sud', 'ne sont pas encore sûres.']), end()] }),
      createPage({
        conditions: questIs(2, QuestStatus.InProgress),
        image: person(3, 8),
        list: [...say('Garde Aldric', GUARD, ['Des herbes médicinales ? Il en pousse dans la forêt de Bruyère,', 'au nord du village. Suis la route jusqu’à la clairière.']), end()],
      }),
    ],
  };
}

/** Borin the woodcutter: the cinematic of quest 3 (balloon, shake, flash, tint, fade, scripted moves). */
function borinEvent(): GameEvent {
  const route = (list: number[]) => ({ list: [...list.map((code) => ({ code })), { code: RouteCmd.End }], repeat: false, skippable: true, wait: true });
  return {
    id: nextEventId++,
    name: 'Bûcheron',
    note: 'Quête 3 : cinématique du tremblement de terre.',
    x: 12,
    y: 16,
    pages: [
      createPage({
        image: person(4, 4),
        list: [...say('Borin', BORIN, ['Cette forêt est paisible… pour le moment.', 'On raconte que des créatures rôdent plus au nord.']), end()],
      }),
      createPage({
        conditions: questIs(3, QuestStatus.InProgress),
        image: person(4, 4),
        list: [
          ...say('Borin', BORIN, ['Tu viens de la part du sage ?', 'Chut… Écoute.']),
          c(Cmd.ShakeScreen, [6, 6, 60, false]),
          c(Cmd.FlashScreen, [[255, 240, 200, 160], 30, false]),
          c(Cmd.ShowBalloon, [0, 1, true]),
          c(Cmd.SetMoveRoute, [0, route([RouteCmd.TurnUp, RouteCmd.MoveUp, RouteCmd.Wait, RouteCmd.TurnLeft, RouteCmd.TurnRight])]),
          c(Cmd.TintScreen, [[-68, -68, -20, 68], 60, true]),
          ...say('Borin', BORIN, ['La terre tremble encore !', 'Des ombres s’éveillent au fond des bois…']),
          c(Cmd.SetMoveRoute, [0, route([RouteCmd.MoveDown, RouteCmd.TurnToward])]),
          ...say('Borin', BORIN, ['Cours prévenir le sage, vite !']),
          c(Cmd.FadeOut),
          c(Cmd.TintScreen, [[0, 0, 0, 0], 1, false]),
          c(Cmd.Wait, [30]),
          c(Cmd.FadeIn),
          end(),
        ],
      }),
      createPage({
        conditions: questIs(3, QuestStatus.InProgress, 1),
        image: person(4, 4),
        list: [...say('Borin', BORIN, ['Qu’attends-tu ? Va prévenir le sage !']), end()],
      }),
      createPage({
        conditions: questIs(3, QuestStatus.Completed),
        image: person(4, 4),
        list: [
          ...say('Borin', BORIN, ['Merci d’avoir prévenu le village.', 'Depuis le tremblement, des slimes envahissent la clairière…', 'Tu pourrais m’en débarrasser de quelques-uns ?']),
          c(Cmd.ShowChoices, [['D’accord', 'Pas maintenant'], 1, 0, 2, 0]),
          c(Cmd.When, [0, 'D’accord']),
          c(MmoCmd.StartQuest, [4], 1),
          ...say('Borin', BORIN, ['Approche-toi d’eux et attaque avec \\C[6]Action\\C[0] ou \\C[6]F\\C[0].', 'Tes compétences sont sur la barre de raccourcis (touches 1 à 8).'], 1),
          end(1),
          c(Cmd.When, [1, 'Pas maintenant']),
          end(1),
          c(Cmd.ChoicesEnd),
          end(),
        ],
      }),
      createPage({
        conditions: questIs(4, QuestStatus.InProgress),
        image: person(4, 4),
        list: [...say('Borin', BORIN, ['Les slimes sont dans la clairière, au nord.', 'Ils ne t’attaqueront pas si tu les laisses tranquilles.']), end()],
      }),
      createPage({
        conditions: questIs(4, QuestStatus.Ready),
        image: person(4, 4),
        list: [...say('Borin', BORIN, ['Bravo ! La clairière respire de nouveau.', 'Tiens, cette tunique te protégera mieux.']), c(MmoCmd.CompleteQuest, [4]), end()],
      }),
      createPage({
        conditions: questIs(4, QuestStatus.Completed),
        image: person(4, 4),
        list: [...say('Borin', BORIN, ['Méfie-toi des chauves-souris près de l’étang :', 'elles attaquent tout ce qui bouge.']), end()],
      }),
    ],
  };
}

/** A medicinal herb for quest 2: visible while the quest runs, picked once per character. */
function herbEvent(x: number, y: number): GameEvent {
  return {
    id: nextEventId++,
    name: 'Herbe médicinale',
    note: 'Quête 2 : visible pendant la quête, cueillie une fois (interrupteur local A).',
    x,
    y,
    pages: [
      createPage({ priorityType: Priority.Below, through: true }),
      createPage({
        conditions: questIs(2, QuestStatus.InProgress),
        image: { tileId: 0, characterName: '!Objects1', characterIndex: 4, direction: 2, pattern: 1 },
        stepAnime: true,
        list: [...textCommands(['Vous cueillez une herbe médicinale.']), c(Cmd.ChangeItems, [4, 0, 0, 1]), c(Cmd.ControlSelfSwitch, ['A', 0]), end()],
      }),
      createPage({ conditions: when({ selfSwitchValid: true, selfSwitchCh: 'A' }), priorityType: Priority.Below, through: true }),
    ],
  };
}

/** Gaspard the merchant: a shop with consumables and the basic equipment. */
function merchantEvent(): GameEvent {
  // [kind (0 item, 1 weapon, 2 armor), id, 0 = database price]
  const goods: [number, number][] = [[0, 1], [0, 2], [0, 4], [0, 5], [1, 1], [1, 2], [1, 3], [1, 4], [2, 1], [2, 2], [2, 3], [2, 4]];
  const [first, ...rest] = goods;
  return {
    id: nextEventId++,
    name: 'Marchand',
    note: 'Boutique : achat et revente.',
    x: 30,
    y: 11,
    pages: [
      createPage({
        image: person(2),
        list: [
          ...say('Gaspard', ['People1', 2], ['Des armes solides, des armures qui brillent…', 'Jette donc un œil à ma marchandise !']),
          c(Cmd.ShopProcessing, [first![0], first![1], 0, 0, false]),
          ...rest.map(([kind, id]) => c(Cmd.ShopItem, [kind, id, 0, 0])),
          end(),
        ],
      }),
    ],
  };
}

/** Rosalie the innkeeper: a night at the inn, which also becomes the respawn point. */
function innkeeperEvent(): GameEvent {
  const ROSALIE: [string, number] = ['People1', 5];
  return {
    id: nextEventId++,
    name: 'Aubergiste',
    note: 'Auberge (20) et point de réapparition.',
    x: 10,
    y: 24,
    pages: [
      createPage({
        image: person(5),
        list: [
          ...say('Rosalie', ROSALIE, ['Bienvenue à l’auberge du Chêne Vert !', 'Une nuit coûte 20 \\G. Tu veux te reposer ?']),
          c(Cmd.ShowChoices, [['Se reposer', 'Non merci'], 1, 0, 2, 0]),
          c(Cmd.When, [0, 'Se reposer']),
          c(MmoCmd.SetRespawn, [0, 0, 0, 0], 1),
          c(MmoCmd.OpenInn, [20], 1),
          ...say('Rosalie', ROSALIE, ['Bonne nuit ! Si tu tombes au combat,', 'c’est ici que tu te réveilleras.'], 1),
          end(1),
          c(Cmd.When, [1, 'Non merci']),
          end(1),
          c(Cmd.ChoicesEnd),
          end(),
        ],
      }),
    ],
  };
}

/** Léa the banker: the personal bank (items and gold kept safe). */
function bankerEvent(x: number, y: number): GameEvent {
  return {
    id: nextEventId++,
    name: 'Banquière',
    note: 'Banque personnelle.',
    x,
    y,
    pages: [
      createPage({
        image: person(7),
        list: [...say('Léa', ['People1', 7], ['Banque de Caranille, bonjour !', 'Tes biens seront en sécurité chez nous.']), c(MmoCmd.OpenBank), end()],
      }),
    ],
  };
}

/** A chest that each character can open once (self switch A). */
function onceChest(name: string, x: number, y: number, itemId: number, count: number, gold: number): GameEvent {
  const image = (direction: 2 | 8) => ({ tileId: 0, characterName: '!Objects1', characterIndex: 0, direction, pattern: 1 });
  return {
    id: nextEventId++,
    name,
    note: 'Interrupteur local A : déjà ouvert par ce personnage.',
    x,
    y,
    pages: [
      createPage({
        image: image(2),
        directionFix: true,
        list: [c(Cmd.ChangeItems, [itemId, 0, 0, count]), c(Cmd.ChangeGold, [0, 0, gold]), c(Cmd.ControlSelfSwitch, ['A', 0]), end()],
      }),
      createPage({
        conditions: when({ selfSwitchValid: true, selfSwitchCh: 'A' }),
        image: image(8),
        directionFix: true,
        list: [...textCommands(['Le coffre est vide.']), end()],
      }),
    ],
  };
}

/** The visitors' book: a global variable counts the signatures of every player, a self switch remembers mine. */
function visitorsBook(x: number, y: number): GameEvent {
  return {
    id: nextEventId++,
    name: 'Registre',
    note: 'Variable 1 (globale) : nombre de signatures.',
    x,
    y,
    pages: [
      createPage({
        list: [
          ...textCommands(['Un registre des visiteurs est posé sur la caisse.', 'Voulez-vous le signer ?']),
          c(Cmd.ShowChoices, [['Signer', 'Laisser'], 1, 0, 2, 0]),
          c(Cmd.When, [0, 'Signer']),
          c(Cmd.ControlVariables, [1, 1, 1, 0, 1], 1),
          c(Cmd.ControlSelfSwitch, ['A', 0], 1),
          ...textCommands(['Vous êtes le visiteur n° \\V[1] à signer le registre !'], ['', 0], '', 1),
          end(1),
          c(Cmd.When, [1, 'Laisser']),
          end(1),
          c(Cmd.ChoicesEnd),
          end(),
        ],
      }),
      createPage({
        conditions: when({ selfSwitchValid: true, selfSwitchCh: 'A' }),
        list: [
          c(Cmd.If, [BranchType.Variable, 1, 0, 10, 1]),
          ...textCommands(['Déjà \\V[1] signatures ! Le village devient célèbre.'], ['', 0], '', 1),
          end(1),
          c(Cmd.Else),
          ...textCommands(['Vous avez déjà signé. \\V[1] visiteurs ont signé à ce jour.'], ['', 0], '', 1),
          end(1),
          c(Cmd.IfEnd),
          end(),
        ],
      }),
    ],
  };
}

/** Builds the starting village. */
export function buildDemoVillage(): MapData {
  nextEventId = 1;
  const W = 40;
  const H = 30;
  const map = createMap(W, H, 1);
  map.displayName = 'Village de Caranille';
  map.mmo = { type: 'town', pvp: false, instance: false };
  const p = new Painter(map);

  // Ground: grass everywhere.
  p.rect(0, 0, W - 1, H - 1, 0, a2(0, 0));

  // Cliffs along the north edge, with a gap for the road to the forest.
  for (let x = 0; x < W; x++) {
    if (x >= 18 && x <= 21) continue;
    p.rect(x, 0, x, 1, 0, a4Top(0));
    p.rect(x, 2, x, 3, 0, a4Side(0));
  }

  // Roads: north-south and east-west, with a cobbled plaza in the middle.
  p.rect(19, 0, 20, H - 1, 1, a2(4, 0));
  p.rect(3, 14, 36, 15, 1, a2(4, 0));
  p.rect(15, 10, 24, 18, 1, a2(4, 1));

  // Pond with lily pads and a fence on its west side.
  p.rect(29, 19, 35, 25, 0, a1(4));
  setTileAt(map, 31, 21, 1, a1(3));
  setTileAt(map, 33, 23, 1, a1(3));
  for (let y = 19; y <= 25; y++) setTileAt(map, 28, y, 2, B(2, 2));
  setTileAt(map, 28, 18, 2, B(3, 2));

  // Houses: home (red roof), weapon shop (blue roof), inn (green roof).
  p.house(5, 5, 6, a3(0, 0), a3(0, 1), C(0, 0));
  p.house(26, 5, 7, a3(1, 0), a3(1, 1), C(0, 0), C(5, 0));
  p.house(5, 18, 7, a3(2, 0), a3(3, 1), C(0, 0), C(0, 1));

  // Plaza: well and lamps.
  p.object(22, 11, 2, B, 0, 5, 2, 2);
  p.object(15, 9, 2, B, 6, 3, 1, 2);
  p.object(24, 9, 2, B, 6, 3, 1, 2);
  p.object(15, 18, 2, B, 6, 3, 1, 2);
  p.object(24, 18, 2, B, 6, 3, 1, 2);

  // Signpost at the south entrance, barrels and crates by the shop.
  setTileAt(map, 21, 25, 2, B(6, 1));
  setTileAt(map, 33, 9, 2, B(7, 1));
  setTileAt(map, 34, 9, 2, B(0, 2));
  setTileAt(map, 25, 9, 2, B(7, 1));

  // Woods along the borders (2 × 2 trees) and some pines.
  const tree = (x: number, y: number, kind = 0) => {
    if (p.free(x, y, x + 1, y + 1)) p.object(x, y, 2, B, kind === 0 ? 0 : kind === 1 ? 2 : 4, kind === 2 ? 6 : 3, 2, 2);
  };
  for (let y = 4; y < H - 1; y += 3) {
    tree(0, y, (y / 3) % 3 === 0 ? 1 : 0);
    tree(38, y, (y / 3) % 2 === 0 ? 2 : 0);
  }
  for (let x = 2; x < 38; x += 3) if (x < 16 || x > 22) tree(x, 28, x % 2);
  for (const [x, y] of [[13, 5], [14, 21], [24, 22], [35, 13], [2, 11], [12, 25]] as const) {
    if (p.free(x, y, x, y + 1)) p.object(x, y, 2, B, 4 + (x % 2), 3, 1, 2);
  }

  // Flowers and bushes on free grass.
  const decor: [number, number, number, number][] = [
    [3, 12, 0, 1], [4, 12, 1, 1], [12, 12, 2, 1], [16, 21, 3, 1], [17, 22, 0, 1], [26, 16, 1, 1],
    [30, 16, 2, 1], [31, 16, 0, 1], [34, 27, 3, 1], [9, 16, 1, 1], [36, 17, 1, 0], [3, 23, 1, 0],
    [13, 8, 2, 0], [23, 26, 1, 0], [27, 13, 4, 1], [28, 13, 4, 1], [29, 13, 4, 1], [11, 27, 4, 1],
  ];
  for (const [x, y, col, row] of decor) if (p.free(x, y, x, y)) setTileAt(map, x, y, 2, B(col, row));

  refreshAllAutotiles(map);

  map.events = [
    null,
    npc('Villageois', 17, 16, 'People1', 0, ['People1', 0], 'Tomas', [
      ['Bienvenue au village de Caranille !', 'La place du puits est le cœur du village.'],
      ['Si tu cherches de l’aventure, prends la route du nord :', 'la forêt n’attend que toi.'],
    ]),
    merchantEvent(),
    guardEvent(),
    sageEvent(),
    innkeeperEvent(),
    {
      id: nextEventId++,
      name: 'Panneau',
      note: '',
      x: 21,
      y: 25,
      pages: [
        createPage({
          priorityType: 1,
          trigger: Trigger.Action,
          list: [...textCommands(['\\C[16]Village de Caranille\\C[0]', 'Nord : forêt de Bruyère — Sud : route du littoral']), { code: 0, indent: 0, parameters: [] }],
        }),
      ],
    },
    teleporter('Vers la forêt', 19, 0, { mapId: DEMO_MAPS.forest, x: 14, y: 28, direction: 8 }),
    teleporter('Vers la forêt', 20, 0, { mapId: DEMO_MAPS.forest, x: 15, y: 28, direction: 8 }),
    teleporter('Porte de la maison', 8, 9, { mapId: DEMO_MAPS.house, x: 6, y: 8, direction: 8 }),
    ...linaEvents(),
    onceChest('Coffre', 9, 11, 1, 2, 30),
    visitorsBook(34, 9),
    bankerEvent(32, 11),
  ];
  return map;
}

/** Builds the forest north of the village. */
export function buildDemoForest(): MapData {
  nextEventId = 1;
  const W = 30;
  const H = 30;
  const map = createMap(W, H, 1);
  map.displayName = 'Forêt de Bruyère';
  map.mmo = { type: 'field', pvp: false, instance: false };
  const p = new Painter(map);
  p.rect(0, 0, W - 1, H - 1, 0, a2(1, 0));
  // Winding path from the south edge to a clearing, and a pond.
  p.rect(14, 18, 15, H - 1, 1, a2(4, 0));
  p.rect(10, 14, 15, 18, 1, a2(4, 0));
  p.rect(8, 8, 18, 14, 1, a2(5, 0));
  p.rect(20, 6, 25, 11, 0, a1(4));
  setTileAt(map, 22, 8, 1, a1(3));
  // Dense trees everywhere except on the path, the clearing and the pond.
  const isOpen = (x: number, y: number) => tileAt(map, x, y, 1) !== 0 || tileAt(map, x, y, 0) !== a2(1, 0);
  for (let y = 0; y < H - 1; y += 2) {
    for (let x = (y / 2) % 2; x < W - 1; x += 2) {
      if (isOpen(x, y) || isOpen(x + 1, y) || isOpen(x, y + 1) || isOpen(x + 1, y + 1)) continue;
      if ((x * 7 + y * 3) % 5 === 0) continue;
      p.object(x, y, 2, B, (x + y) % 3 === 0 ? 4 : 0, (x + y) % 3 === 0 ? 6 : 3, 2, 2);
    }
  }
  for (const [x, y, col, row] of [[9, 9, 5, 0], [17, 12, 6, 0], [11, 13, 0, 1], [16, 9, 2, 1], [12, 10, 4, 1], [13, 11, 4, 1]] as const) {
    setTileAt(map, x, y, 2, B(col, row));
  }
  // Monster areas: region 1 = the clearing (slimes, mushrooms), region 2 = around the pond (bats).
  for (let y = 8; y <= 13; y++) for (let x = 8; x <= 18; x++) setTileAt(map, x, y, REGION_LAYER, 1);
  for (let y = 5; y <= 12; y++) for (let x = 19; x <= 26; x++) setTileAt(map, x, y, REGION_LAYER, 2);
  map.mmo.spawns = [
    { enemyId: 1, count: 4, region: 1 },
    { enemyId: 6, count: 2, region: 1 },
    { enemyId: 2, count: 2, region: 2 },
  ];
  refreshAllAutotiles(map);
  map.events = [
    null,
    borinEvent(),
    teleporter('Vers le village', 14, 29, { mapId: DEMO_MAPS.village, x: 19, y: 1, direction: 2 }),
    teleporter('Vers le village', 15, 29, { mapId: DEMO_MAPS.village, x: 20, y: 1, direction: 2 }),
    herbEvent(9, 11),
    herbEvent(18, 10),
    herbEvent(10, 16),
    teleporter('Entrée de la grotte', 12, 8, { mapId: DEMO_MAPS.dungeon, x: 12, y: 19, direction: 8 }),
    torch(11, 8),
    torch(13, 8),
  ];
  return map;
}

/** A lit torch (solid object) marking a place. */
function torch(x: number, y: number): GameEvent {
  return {
    id: nextEventId++,
    name: 'Torche',
    note: '',
    x,
    y,
    pages: [createPage({ image: { tileId: 0, characterName: '!Objects1', characterIndex: 2, direction: 2, pattern: 1 }, stepAnime: true, directionFix: true })],
  };
}

/**
 * Builds the cave north of the forest: an instanced dungeon (each party gets
 * its own copy) with bats and goblins in the hall and the Goblin King, boss of
 * the demo raid, in the room at the far end.
 */
export function buildDemoDungeon(): MapData {
  nextEventId = 1;
  const W = 26;
  const H = 22;
  const map = createMap(W, H, 3);
  map.displayName = 'Grotte de Bruyère';
  const p = new Painter(map);
  const floor = a2(0, 0);
  // Dark stone walls stand out from the earthen floor.
  const wallTop = a4Top(2);
  const wallSide = a4Side(2);
  p.rect(0, 0, W - 1, H - 1, 0, wallTop);
  // Rooms and corridors, from the entrance (south) to the boss room (north).
  const rooms: [number, number, number, number][] = [
    [8, 16, 17, 20], // entrance
    [12, 13, 13, 15], // corridor
    [4, 9, 21, 12], // hall
    [12, 6, 13, 8], // corridor
    [6, 2, 19, 5], // boss room
  ];
  for (const [x0, y0, x1, y1] of rooms) p.rect(x0, y0, x1, y1, 0, floor);
  // Wall faces above every floor cell under a wall top.
  for (let y = 1; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (tileAt(map, x, y, 0) === floor && tileAt(map, x, y - 1, 0) === wallTop) setTileAt(map, x, y - 1, 0, wallSide);
    }
  }
  // The faces take a row of floor: give it back to the rooms below.
  for (const [x0, y0, x1] of rooms) for (let x = x0; x <= x1; x++) if (tileAt(map, x, y0, 0) === wallSide) setTileAt(map, x, y0, 0, floor);
  p.rect(10, 3, 15, 4, 1, a2(7, 0)); // throne carpet
  for (const [x, y] of [[9, 8], [16, 8], [6, 1], [19, 1], [10, 15], [15, 15]] as const) if (tileAt(map, x, y, 0) === wallSide) setTileAt(map, x, y, 2, B(1, 0));
  for (const [x, y, col] of [[6, 11, 2], [18, 10, 3], [10, 18, 6], [20, 9, 7], [7, 3, 2]] as const) setTileAt(map, x, y, 2, B(col, 0));
  // Monster areas: region 1 = the hall, region 2 = the boss room.
  for (let y = 9; y <= 12; y++) for (let x = 4; x <= 21; x++) setTileAt(map, x, y, REGION_LAYER, 1);
  setTileAt(map, 12, 3, REGION_LAYER, 2);
  map.mmo = {
    type: 'dungeon',
    pvp: false,
    instance: true,
    spawns: [
      { enemyId: 2, count: 3, region: 1 },
      { enemyId: 4, count: 2, region: 1 },
      { enemyId: 8, count: 1, region: 2 },
    ],
  };
  refreshAllAutotiles(map);
  map.events = [
    null,
    teleporter('Sortie de la grotte', 12, 20, { mapId: DEMO_MAPS.forest, x: 12, y: 10, direction: 2 }),
    teleporter('Sortie de la grotte', 13, 20, { mapId: DEMO_MAPS.forest, x: 12, y: 10, direction: 2 }),
  ];
  return map;
}

/** Builds the interior of the first village house. */
export function buildDemoHouse(): MapData {
  nextEventId = 1;
  const W = 12;
  const H = 10;
  const map = createMap(W, H, 2);
  map.displayName = 'Maison de Tomas';
  map.mmo = { type: 'town', pvp: false, instance: false };
  const p = new Painter(map);
  const floor = a2(0, 0);
  const wallTop = a4Top(0);
  const wallSide = a4Side(0);
  // Outer walls: top rows are the wall top, then the wall face; side columns are wall tops.
  p.rect(0, 0, W - 1, H - 1, 0, floor);
  p.rect(0, 0, W - 1, 0, 0, wallTop);
  p.rect(0, 1, W - 1, 2, 0, wallSide);
  p.rect(0, 0, 0, H - 1, 0, wallTop);
  p.rect(W - 1, 0, W - 1, H - 1, 0, wallTop);
  p.rect(0, H - 1, W - 1, H - 1, 0, wallTop);
  setTileAt(map, 6, H - 1, 0, floor);
  // Furniture.
  setTileAt(map, 2, 1, 2, B(6, 3)); // window
  setTileAt(map, 9, 1, 2, B(6, 3));
  p.object(4, 1, 2, B, 4, 3, 2, 2); // fireplace
  p.object(1, 3, 2, B, 0, 3, 1, 2); // bed
  p.object(10, 2, 2, B, 2, 3, 1, 2); // bookshelf
  p.object(5, 5, 2, B, 4, 1, 2, 1); // table
  setTileAt(map, 5, 4, 2, B(0, 1)); // chairs
  setTileAt(map, 6, 6, 2, B(3, 1));
  setTileAt(map, 10, 7, 2, B(4, 0)); // pot
  setTileAt(map, 1, 7, 2, B(1, 0)); // chest
  setTileAt(map, 3, 6, 2, B(3, 2)); // plant
  p.rect(5, 7, 7, 8, 1, a2(4, 0)); // red carpet by the door
  refreshAllAutotiles(map);
  map.events = [
    null,
    teleporter('Sortie', 6, 9, { mapId: DEMO_MAPS.village, x: 8, y: 10, direction: 2 }),
  ];
  return map;
}

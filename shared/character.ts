/**
 * @file Character sheet shared by the server and the client: parameter
 * points distributed at level up, the sheet payload (parameters with their
 * origin, equipment), and the shop and bank windows.
 */
import type { EquipSlot, ParamName, ParamValues } from './database.js';

/** Parameter gained per distributed point. */
export const POINT_GAIN: Record<ParamName, number> = { mhp: 5, mmp: 5, atk: 1, def: 1, mat: 1, mdf: 1, agi: 1, luk: 1 };

/**
 * Points still to distribute.
 * @param perLevel - Points given at each level up (System settings).
 * @param allocated - Points already distributed, by parameter.
 */
export function freePoints(level: number, perLevel: number, allocated: Partial<Record<ParamName, number>>): number {
  const spent = Object.values(allocated).reduce((s, n) => s + (n ?? 0), 0);
  return Math.max(0, (level - 1) * perLevel - spent);
}

/** An equipped item (texts are game content). */
export interface EquippedView {
  kind: 'weapon' | 'armor';
  id: number;
  name: string;
  icon: number;
  params: ParamValues;
}

/** Payload of the `sheet` event: everything the status and equipment windows show. */
export interface SheetPayload {
  /** Final parameters (class, equipment, points, states). */
  params: ParamValues;
  /** Parameters from the class curves alone. */
  base: ParamValues;
  /** Distributed points and points left. */
  allocated: Partial<Record<ParamName, number>>;
  freePoints: number;
  equipment: Record<EquipSlot, EquippedView | null>;
  /** Names of the element / weapon / armor types (System settings). */
  weaponTypes: string[];
  armorTypes: string[];
  /** Weapon and armor types the class may equip (empty = all). */
  allowedWeaponTypes: number[];
  allowedArmorTypes: number[];
}

/** One article of a shop. */
export interface ShopGood {
  kind: 'item' | 'weapon' | 'armor';
  id: number;
  name: string;
  description: string;
  icon: number;
  price: number;
  /** Equipment only: its parameters and slot, for the comparison with what is worn. */
  params?: ParamValues;
  slot?: EquipSlot;
}

/** Payload of the `shopOpen` event. */
export interface ShopPayload {
  goods: ShopGood[];
  purchaseOnly: boolean;
  /** Resale price in percent of the item price. */
  sellRate: number;
}

/** Payload of the `bank` event (sent when the bank opens and after each move). */
export interface BankPayload {
  gold: number;
  entries: { kind: 'item' | 'weapon' | 'armor'; id: number; quantity: number; name: string; icon: number; description: string }[];
}

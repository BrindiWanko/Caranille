/**
 * @file Guild emblem generator: a shape (shield, round, banner, diamond)
 * filled with a pattern of two colours and a symbol, drawn as an SVG string
 * (64 × 64). The same function runs on the client (guild window, names) and
 * could run on the server.
 */
import { EMBLEM_COLORS, EMBLEM_PATTERNS, EMBLEM_SHAPES, EMBLEM_SYMBOLS, type Emblem } from '../guild.js';

const OUTLINES: Record<(typeof EMBLEM_SHAPES)[number], string> = {
  shield: 'M8 6 H56 V30 C56 46 44 55 32 60 C20 55 8 46 8 30 Z',
  round: 'M32 4 A28 28 0 1 1 31.9 4 Z',
  banner: 'M10 4 H54 V58 L32 48 L10 58 Z',
  diamond: 'M32 3 L61 32 L32 61 L3 32 Z',
};

const PATTERNS: Record<(typeof EMBLEM_PATTERNS)[number], string> = {
  plain: '',
  halves: '<rect x="32" y="0" width="32" height="64"/>',
  quarters: '<rect x="32" y="0" width="32" height="32"/><rect x="0" y="32" width="32" height="32"/>',
  stripe: '<path d="M0 22 L22 0 H36 L0 36 Z M28 64 L64 28 V42 L42 64 Z"/>',
  chevron: '<path d="M0 30 L32 12 L64 30 V44 L32 26 L0 44 Z"/>',
};

const SYMBOLS: Record<(typeof EMBLEM_SYMBOLS)[number], string> = {
  star: 'M32 16 L36 27 L48 27 L38 34 L42 46 L32 39 L22 46 L26 34 L16 27 L28 27 Z',
  sword: 'M30 12 H34 V38 H40 V42 H34 V48 H30 V42 H24 V38 H30 Z',
  crown: 'M18 42 L16 22 L24 30 L32 18 L40 30 L48 22 L46 42 Z',
  tree: 'M32 14 L44 32 H38 L46 42 H34 V50 H30 V42 H18 L26 32 H20 Z',
  moon: 'M38 14 A18 18 0 1 0 38 50 A14 14 0 1 1 38 14 Z',
  flame: 'M32 12 C40 22 46 28 44 38 C43 46 37 50 32 50 C27 50 21 46 20 38 C19 30 26 28 28 20 C31 26 30 30 34 32 C35 26 34 20 32 12 Z',
  key: 'M26 14 A9 9 0 1 1 25.9 14 Z M28 30 H32 V50 H38 V46 H34 V42 H38 V38 H32 V30 Z',
  wing: 'M16 40 C18 26 30 16 48 14 C44 20 46 22 40 26 C44 28 42 32 36 32 C40 36 36 40 30 38 C28 42 22 44 16 40 Z',
};

/**
 * SVG markup of an emblem.
 * @param e - Emblem (indices into the shared lists).
 * @param id - Unique suffix for the clip path when several emblems share a page.
 */
export function emblemSvg(e: Emblem, id = 'e'): string {
  const shape = OUTLINES[EMBLEM_SHAPES[e.shape] ?? 'shield'];
  const primary = EMBLEM_COLORS[e.primary] ?? EMBLEM_COLORS[0];
  const secondary = EMBLEM_COLORS[e.secondary] ?? EMBLEM_COLORS[1];
  const ink = EMBLEM_COLORS[e.symbolColor] ?? EMBLEM_COLORS[7];
  const pattern = PATTERNS[EMBLEM_PATTERNS[e.pattern] ?? 'plain'];
  const symbol = SYMBOLS[EMBLEM_SYMBOLS[e.symbol] ?? 'star'];
  const clip = `clip-${id.replace(/[^a-z0-9-]/gi, '')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><clipPath id="${clip}"><path d="${shape}"/></clipPath></defs><g clip-path="url(#${clip})"><rect width="64" height="64" fill="${primary}"/><g fill="${secondary}">${pattern}</g></g><path d="${symbol}" fill="${ink}" stroke="#101010" stroke-width="1.5" stroke-linejoin="round"/><path d="${shape}" fill="none" stroke="#101010" stroke-width="3"/><path d="${shape}" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="1" transform="translate(32 32) scale(0.9) translate(-32 -32)"/></svg>`;
}

/** Emblem as a data URL (for `<img>`). */
export function emblemDataUrl(e: Emblem, id?: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(emblemSvg(e, id))}`;
}

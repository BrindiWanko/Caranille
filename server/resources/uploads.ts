/**
 * @file Storage of resources uploaded by administrators (editor resource
 * manager and project imports).
 *
 * Files go to `uploads/img/<kind>/` or `uploads/audio/<kind>/` under a
 * sanitised name. Only known image and audio types are accepted, recognised by
 * their content (magic bytes), not by the name. SVG files are accepted only
 * when they contain no scripting or external references, because uploads are
 * served from the game's own origin.
 */
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { IMAGE_KINDS, RESOURCE_KINDS, type ResourceKind } from '../../shared/resource-formats.js';
import { PATHS } from '../paths.js';

/** Largest accepted file. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Detected file type of an upload. */
export type UploadType = 'png' | 'jpg' | 'webp' | 'svg' | 'ogg' | 'm4a' | 'mp3' | 'wav';

/**
 * Recognises a file type from its first bytes.
 * @param data - File content.
 * @returns The type, or `null` when unsupported.
 */
export function sniffType(data: Buffer): UploadType | null {
  if (data.length >= 8 && data.readUInt32BE(0) === 0x89504e47) return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (data.length >= 4 && data.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (data.length >= 8 && data.toString('ascii', 4, 8) === 'ftyp') return 'm4a';
  if (data.length >= 3 && (data.toString('ascii', 0, 3) === 'ID3' || (data[0] === 0xff && (data[1]! & 0xe0) === 0xe0))) return 'mp3';
  const head = data.subarray(0, 1024).toString('utf8').trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return null;
}

/** Named character references that can hide a dangerous scheme or separator. */
const NAMED_REFERENCES: Record<string, string> = { colon: ':', tab: '\t', newline: '\n', sol: '/', lpar: '(', rpar: ')', quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' };

/** Decodes the character references of a text (`&#106;`, `&#x6A;`, `&colon;`...). */
function decodeReferences(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));?/gi, (all, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    const code = dec !== undefined ? Number(dec) : hex !== undefined ? Number.parseInt(hex, 16) : -1;
    if (code >= 0) return code <= 0x10ffff ? String.fromCodePoint(code) : '';
    return NAMED_REFERENCES[name!.toLowerCase()] ?? all;
  });
}

/**
 * Tells whether an SVG document is safe to serve from the game's origin: no
 * scripts, no event handler attributes, no embedded HTML, no external or
 * `javascript:` links, no animation rewriting a link, no entity declarations.
 * Character references are decoded first so they cannot hide a forbidden word.
 * (Uploads are also served with a sandboxing Content-Security-Policy.)
 * @param svg - SVG source.
 */
export function isSafeSvg(svg: string): boolean {
  const lower = decodeReferences(svg).toLowerCase();
  // Without spaces and control characters: `java\tscript:` is still `javascript:` for a browser.
  const compact = lower.replace(/[\s\u0000-\u001f]+/g, '');
  if (/<script|<foreignobject|<iframe|<object|<embed|<!entity|<!doctype|<handler|<listener/.test(lower)) return false;
  if (/[\s/"']on[a-z]+\s*=/.test(lower)) return false;
  if (/javascript:|data:text\/html|vbscript:|data:image\/svg/.test(compact)) return false;
  // Animations may not rewrite links or event attributes.
  if (/attributename\s*=\s*["']?\s*(?:xlink:)?(?:href|on)/.test(lower)) return false;
  // Links may only point inside the document (#id).
  for (const m of lower.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/g)) if (!m[1]!.trim().startsWith('#')) return false;
  if (/(?:xlink:)?href\s*=\s*[^"'\s]/.test(lower)) return false;
  if (/url\(\s*["']?(?!#)/.test(lower) || /@import/.test(lower)) return false;
  return true;
}

/**
 * Makes a safe file name: keeps letters, digits, `_`, `-`, spaces and the
 * special sheet prefixes `$` and `!`; strips paths and extensions.
 * @param name - Name proposed by the client.
 */
export function sanitizeName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const withoutExt = base.replace(/\.[a-z0-9]+$/i, '');
  return withoutExt.replace(/[^\p{L}\p{N}_\-$! ]/gu, '').trim().slice(0, 80);
}

/** Tells whether a kind is valid for a file type. */
function kindMatchesType(kind: ResourceKind, type: UploadType): boolean {
  const image = type === 'png' || type === 'jpg' || type === 'webp' || type === 'svg';
  return image === IMAGE_KINDS.includes(kind);
}

/** Result of storing an upload. */
export type StoreResult = { ok: true; id: string } | { ok: false; errorKey: string };

/**
 * Validates and writes an uploaded file.
 * @param kind - Resource folder.
 * @param name - Proposed name.
 * @param data - Content.
 */
export function storeUpload(kind: string, name: string, data: Buffer): StoreResult {
  if (!RESOURCE_KINDS.includes(kind as ResourceKind)) return { ok: false, errorKey: 'error.resources.invalid_kind' };
  if (data.length === 0 || data.length > MAX_UPLOAD_BYTES) return { ok: false, errorKey: 'error.resources.too_large' };
  const type = sniffType(data);
  if (!type) return { ok: false, errorKey: 'error.resources.unsupported_type' };
  if (!kindMatchesType(kind as ResourceKind, type)) return { ok: false, errorKey: 'error.resources.wrong_kind' };
  if (type === 'svg' && !isSafeSvg(data.toString('utf8'))) return { ok: false, errorKey: 'error.resources.unsafe_svg' };
  const clean = sanitizeName(name);
  if (!clean) return { ok: false, errorKey: 'error.resources.invalid_name' };
  const folder = join(PATHS.uploads, IMAGE_KINDS.includes(kind as ResourceKind) ? 'img' : 'audio', kind);
  mkdirSync(folder, { recursive: true });
  // One file per resource id: remove other extensions of the same name first.
  for (const ext of ['png', 'jpg', 'webp', 'svg', 'ogg', 'm4a', 'mp3', 'wav']) {
    const other = join(folder, `${clean}.${ext}`);
    if (existsSync(other)) unlinkSync(other);
  }
  writeFileSync(join(folder, `${clean}.${type}`), data);
  return { ok: true, id: `${kind}/${clean}` };
}

/**
 * Deletes an uploaded resource (generated resources cannot be deleted).
 * @param path - Path relative to the project root, as stored in the manifest.
 */
export function deleteUpload(path: string): boolean {
  if (!path.startsWith('uploads/') || path.includes('..')) return false;
  const full = join(PATHS.root, path);
  if (!existsSync(full)) return false;
  unlinkSync(full);
  return true;
}

/**
 * Guesses the resource kind of an image from its name and size, for drops
 * without an explicit folder (standard sheet suffixes, `$`/`!` character
 * prefixes, face and window sizes...).
 */
export function guessKind(name: string, width: number, height: number): ResourceKind {
  const lower = name.toLowerCase();
  if (/_(a[1-5]|[b-e])$/.test(lower) || (width === 480 && height === 256) || (width === 96 && height === 128)) return 'tilesets';
  if (lower === 'window' || lower === 'iconset' || lower === 'balloon' || lower.startsWith('shadow')) return 'system';
  if (lower.startsWith('$') || lower.startsWith('!')) return 'characters';
  if ((width === 576 && height === 288) || (width === 192 && height === 192)) return 'faces';
  if (width % 12 === 0 && height % 8 === 0 && width / 12 <= 96 && height / 8 <= 128) return 'characters';
  if (width >= 800 || height >= 600) return 'parallaxes';
  return 'pictures';
}

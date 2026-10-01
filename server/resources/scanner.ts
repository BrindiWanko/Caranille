/**
 * @file Scans resource folders and builds manifest entries.
 *
 * Generated graphics live in `assets/img/<kind>/`, creator uploads in
 * `uploads/img/<kind>/`, sounds in `audio/<kind>/`. For every file the scanner
 * reads the pixel size (from the SVG root attributes or the PNG header),
 * detects the sheet format and computes a short content hash, which the client
 * uses for cache busting.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { RESOURCE_KINDS, detectFormat, type ResourceKind } from '../../shared/resource-formats.js';
import type { ScannedResource } from '../db/resources.js';
import { PATHS } from '../paths.js';

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/**
 * Reads the pixel size of an image file.
 * @param data - File content.
 * @param ext - Lower-case extension.
 * @returns Width and height, or zeros when unknown.
 */
export function imageSize(data: Buffer, ext: string): { width: number; height: number } {
  if (ext === '.svg') {
    const head = data.subarray(0, 512).toString('utf8');
    const w = /\swidth="(\d+(?:\.\d+)?)"/.exec(head);
    const h = /\sheight="(\d+(?:\.\d+)?)"/.exec(head);
    return { width: w ? Math.round(Number(w[1])) : 0, height: h ? Math.round(Number(h[1])) : 0 };
  }
  if (ext === '.png' && data.length >= 24 && data.toString('ascii', 12, 16) === 'IHDR') {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  return { width: 0, height: 0 };
}

function scanFolder(base: string, kind: ResourceKind, origin: ScannedResource['origin'], out: Map<string, ScannedResource>): void {
  const dir = join(base, kind);
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    const full = join(dir, file);
    const ext = extname(file).toLowerCase();
    const mime = MIME[ext];
    if (!mime || !statSync(full).isFile()) continue;
    const name = file.slice(0, -ext.length);
    const id = `${kind}/${name}`;
    const data = readFileSync(full);
    const { width, height } = imageSize(data, ext);
    // Uploaded files override generated ones with the same id.
    out.set(id, {
      id,
      kind,
      name,
      path: relative(PATHS.root, full).replaceAll('\\', '/'),
      format: detectFormat(kind, name, width, height).format,
      mime,
      width: width || null,
      height: height || null,
      hash: createHash('sha1').update(data).digest('hex').slice(0, 12),
      origin,
    });
  }
}

/** Scans every resource folder. */
export function scanResources(): ScannedResource[] {
  const found = new Map<string, ScannedResource>();
  for (const kind of RESOURCE_KINDS) {
    scanFolder(join(PATHS.assets, 'img'), kind, 'generated', found);
    scanFolder(PATHS.audio, kind, 'generated', found);
    scanFolder(join(PATHS.uploads, 'img'), kind, 'uploaded', found);
    scanFolder(join(PATHS.uploads, 'audio'), kind, 'uploaded', found);
  }
  return [...found.values()];
}

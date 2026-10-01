/**
 * @file Minimal PNG encoder for generator previews (`--png=<dir>`), so sheets
 * can be inspected as bitmaps without a browser. Output is 8-bit RGBA.
 */
import { deflateSync } from 'node:zlib';
import type { PixelCanvas } from '../../shared/art/pixel.js';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * Encodes a canvas as PNG.
 * @param canvas - Source canvas.
 * @param scale - Integer magnification.
 * @param background - Optional `#rrggbb` drawn under transparent pixels.
 */
export function encodePng(canvas: PixelCanvas, scale: number, background?: string): Buffer {
  const w = canvas.width * scale;
  const h = canvas.height * scale;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  const bg = background ? [1, 3, 5].map((i) => Number.parseInt(background.slice(i, i + 2), 16)) : null;
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const c = canvas.get(Math.floor(x / scale), Math.floor(y / scale));
      const o = y * (w * 4 + 1) + 1 + x * 4;
      let rgba = [0, 0, 0, 0];
      if (c) {
        rgba = [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
        rgba.push(c.length === 9 ? Number.parseInt(c.slice(7, 9), 16) : 255);
      }
      if (bg) {
        const a = rgba[3]! / 255;
        rgba = [0, 1, 2].map((i) => Math.round(rgba[i]! * a + bg[i]! * (1 - a)));
        rgba.push(255);
      }
      raw.set(rgba, o);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

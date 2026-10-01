/**
 * @file Minimal ZIP archive reader for project imports (no dependency).
 *
 * Reads the central directory at the end of the archive, then each entry's
 * data (stored or deflated). Limits protect the server against malicious
 * archives: number of entries, total uncompressed size and compression ratio
 * ("zip bombs"). Entry names are only used to recognise files, never as paths
 * on disk.
 */
import { inflateRawSync } from 'node:zlib';

/** One file of an archive. */
export interface ZipEntry {
  /** Path inside the archive, with forward slashes. */
  name: string;
  data: Buffer;
}

/** Limits applied while reading. */
export interface ZipLimits {
  maxEntries: number;
  maxTotalBytes: number;
  /** Largest accepted uncompressed/compressed ratio for one entry. */
  maxRatio: number;
}

/** Default limits: enough for a large game project, safe for the server. */
export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 20_000, maxTotalBytes: 600 * 1024 * 1024, maxRatio: 200 };

/** Error with a translation key describing why an archive was refused. */
export class ZipError extends Error {
  constructor(readonly key: string) {
    super(key);
  }
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * Lists and extracts the files of an archive (directories are skipped).
 * @param buf - Archive content.
 * @param limits - Safety limits.
 * @throws {ZipError} On a malformed or oversized archive.
 */
export function readZip(buf: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  // The end-of-central-directory record is in the last 64 KiB (after an optional comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('error.import.not_zip');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (count > limits.maxEntries) throw new ZipError('error.import.too_many_files');
  const entries: ZipEntry[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL) throw new ZipError('error.import.corrupt');
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength).replace(/\\/g, '/');
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    total += size;
    if (total > limits.maxTotalBytes) throw new ZipError('error.import.too_large');
    if (compressed > 0 && size / compressed > limits.maxRatio) throw new ZipError('error.import.corrupt');
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL) throw new ZipError('error.import.corrupt');
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compressed);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try {
        data = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
      } catch {
        throw new ZipError('error.import.corrupt');
      }
    } else throw new ZipError('error.import.unsupported_compression');
    entries.push({ name, data });
  }
  return entries;
}

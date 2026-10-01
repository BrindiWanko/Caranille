/**
 * @file Message control codes.
 *
 * Messages may contain escape codes interpreted while the text is typed out:
 *   `\C[n]`  switch to text colour n of the window skin palette (0 = normal);
 *   `\I[n]`  draw icon n of the icon sheet;
 *   `\.`     pause for a quarter of a second;  `\|` pause for one second;
 *   `\!`     wait for the player to press Action before continuing;
 *   `\\`     a literal backslash.
 * (`\P`, the player's name, is replaced by the server before sending.)
 */

/** A piece of parsed message. */
export type Segment =
  | { type: 'text'; text: string }
  | { type: 'color'; index: number }
  | { type: 'icon'; index: number }
  | { type: 'pause'; frames: number }
  | { type: 'wait' }
  | { type: 'newline' };

/**
 * Parses a message into segments.
 * @param source - Raw text with control codes.
 */
export function parseMessage(source: string): Segment[] {
  const out: Segment[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) out.push({ type: 'text', text: buffer });
    buffer = '';
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === '\n') {
      flush();
      out.push({ type: 'newline' });
      continue;
    }
    if (ch !== '\\') {
      buffer += ch;
      continue;
    }
    const code = source[i + 1] ?? '';
    const arg = /^\[(\d+)\]/.exec(source.slice(i + 2));
    if ((code === 'C' || code === 'c' || code === 'I' || code === 'i') && arg) {
      flush();
      const index = Number(arg[1]);
      out.push(code.toUpperCase() === 'C' ? { type: 'color', index: Math.min(31, index) } : { type: 'icon', index });
      i += 1 + arg[0].length;
    } else if (code === '.') {
      flush();
      out.push({ type: 'pause', frames: 15 });
      i++;
    } else if (code === '|') {
      flush();
      out.push({ type: 'pause', frames: 60 });
      i++;
    } else if (code === '!') {
      flush();
      out.push({ type: 'wait' });
      i++;
    } else if (code === '\\') {
      buffer += '\\';
      i++;
    } else {
      buffer += ch;
    }
  }
  flush();
  return out;
}

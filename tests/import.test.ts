/**
 * @file Import / export tests: layout conversions, upload checks (type
 * sniffing, SVG safety, kind guessing), ZIP reading, a full project import
 * from a synthetic project archive, and map export round trip.
 */
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { convertCharacter16, convertChipset16, convertLegacyAutotile, convertLegacyTileset, tilesetSheetNames } from '../shared/conversions.js';
import { BranchType, Cmd, createPage } from '../shared/events.js';
import { createMap, tileAt } from '../shared/map.js';
import { TILE_ID_A2 } from '../shared/tiles.js';
import { convertMap, exportMap } from '../server/importers/project.js';
import { ZipError, readZip } from '../server/importers/zip.js';
import { PATHS } from '../server/paths.js';
import { guessKind, isSafeSvg, sanitizeName, sniffType } from '../server/resources/uploads.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

// --- Helpers -------------------------------------------------------------------------

/** Builds a ZIP archive (deflated entries). */
function makeZip(files: Record<string, Buffer | string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const packed = deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/** PNG header of a given size (enough for type sniffing and size reading). */
function fakePng(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

// --- Conversions ----------------------------------------------------------------------

test('legacy autotiles map their 3 × 3 patch onto the 2 × 2 standard patch', () => {
  const { A2 } = convertLegacyAutotile(96);
  assert.equal(A2!.ops.length, 2 + 16);
  const patch = A2!.ops.slice(2);
  // Standard quarter (1, 0) of the patch = legacy quarter column 2 (centre tile, left half), row 0 of the patch.
  assert.deepEqual([patch[1]!.sx, patch[1]!.sy, patch[1]!.dx, patch[1]!.dy], [32, 32, 24, 48]);
  // Bottom-right corner quarter comes from the legacy outer ring.
  assert.deepEqual([patch[15]!.sx, patch[15]!.sy], [80, 112]);
});

test('legacy tilesets fill B–E page halves of 16 rows', () => {
  const pages = convertLegacyTileset(256, 32 * 40);
  assert.deepEqual(Object.keys(pages), ['B', 'C']);
  assert.equal(pages.B!.ops.length, 2);
  assert.equal(pages.C!.ops.length, 1, 'rows 32–39 only fill the left half of C');
  assert.equal(pages.C!.ops[0]!.sh, 8 * 32);
});

test('16 px chipsets and character sheets follow their region tables', () => {
  const chip = convertChipset16();
  assert.equal(chip.A2!.ops.length, 12 * 18);
  assert.deepEqual([chip.A5!.ops[0]!.sx, chip.A5!.ops[0]!.sy], [12 * 16, 0], 'first lower tile at column 12');
  assert.deepEqual([chip.A5!.ops[6]!.sx, chip.A5!.ops[6]!.sy], [12 * 16, 16], 'rows of six');
  assert.deepEqual([chip.C!.ops[0]!.sx, chip.C!.ops[0]!.sy], [18 * 16, 8 * 16], 'first upper tile');
  assert.deepEqual([chip.C!.ops[0]!.dx, chip.C!.ops[0]!.dy], [48, 0], 'page tile 0 stays empty');
  const chars = convertCharacter16(288, 256)['0']!;
  // Standard row 0 (facing down) comes from source row 2.
  assert.deepEqual([chars.ops[0]!.sy, chars.ops[0]!.dy, chars.ops[0]!.dh], [64, 0, 96]);
  assert.deepEqual(tilesetSheetNames('Chip', 'chipset16', 480, 256), ['Chip~A2', 'Chip~A5', 'Chip~B', 'Chip~C']);
  assert.deepEqual(tilesetSheetNames('Outside_A2', 'standard-tileset-a2', 768, 576), ['Outside_A2']);
});

// --- Upload checks ------------------------------------------------------------------------

test('uploads are recognised by content; unsafe SVG and names are refused', () => {
  assert.equal(sniffType(fakePng(4, 4)), 'png');
  assert.equal(sniffType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(sniffType(Buffer.from('hello')), null);
  assert.equal(isSafeSvg('<svg><path fill="#fff" d="M0 0h1v1z"/></svg>'), true);
  assert.equal(isSafeSvg('<svg><script>alert(1)</script></svg>'), false);
  assert.equal(isSafeSvg('<svg onload="x()"></svg>'), false);
  assert.equal(isSafeSvg('<svg><image href="https://evil.example/a.png"/></svg>'), false);
  assert.equal(isSafeSvg('<svg><use href="#a"/></svg>'), true);
  // Tricks that hide a script from a naive filter.
  assert.equal(isSafeSvg('<svg/onload="x()"></svg>'), false);
  assert.equal(isSafeSvg('<svg><a><animate attributeName="href" values="&#106;avascript:alert(1)"/></a></svg>'), false);
  assert.equal(isSafeSvg('<svg><a href="java&#x09;script:alert(1)">x</a></svg>'), false);
  assert.equal(isSafeSvg('<svg><a href="&#106;avascript&colon;alert(1)">x</a></svg>'), false);
  assert.equal(isSafeSvg('<svg><a href=javascript:alert(1)>x</a></svg>'), false);
  assert.equal(isSafeSvg('<svg><style>@import "https://evil.example/x.css";</style></svg>'), false);
  assert.equal(isSafeSvg('<svg><set attributeName="onmouseover" to="alert(1)"/></svg>'), false);
  assert.equal(isSafeSvg('<svg><text>Tom &amp; Jerry &#233;t&#233;</text></svg>'), true);
  assert.equal(sanitizeName('../../etc/$Hero!.png'), '$Hero!');
  assert.equal(guessKind('Outside_A2', 768, 576), 'tilesets');
  assert.equal(guessKind('Chipset', 480, 256), 'tilesets');
  assert.equal(guessKind('$Boss', 432, 512), 'characters');
  assert.equal(guessKind('Actor2', 576, 288), 'faces');
});

test('ZIP archives are read; garbage and bombs are refused', () => {
  const zip = makeZip({ 'a/b.txt': 'hello', 'c.json': '{"x":1}' });
  const entries = readZip(zip);
  assert.deepEqual(entries.map((e) => [e.name, e.data.toString()]), [['a/b.txt', 'hello'], ['c.json', '{"x":1}']]);
  assert.throws(() => readZip(Buffer.from('not a zip at all, clearly')), ZipError);
  const bomb = makeZip({ 'big.txt': Buffer.alloc(5_000_000) });
  assert.throws(() => readZip(bomb), (e: unknown) => e instanceof ZipError && e.key === 'error.import.corrupt');
});

test('map export and re-import give the same map', () => {
  const map = createMap(6, 4, 1);
  map.data[5] = TILE_ID_A2;
  map.displayName = 'Test';
  map.events = [null, { id: 1, name: 'Sign', note: '', x: 2, y: 1, pages: [createPage()] }];
  const back = convertMap(exportMap(map), 1, () => undefined, new Map());
  assert.deepEqual(back.data, map.data);
  assert.equal(back.displayName, 'Test');
  assert.deepEqual(back.events[1], map.events[1]);
});

test('imported maps report the events that contain scripts (they run on the server)', () => {
  const map = createMap(3, 2, 1);
  const page = (list: unknown[]) => ({ ...createPage(), list });
  map.events = [
    null,
    { id: 1, name: 'Script', note: '', x: 0, y: 0, pages: [page([{ code: Cmd.Script, indent: 0, parameters: ['setV(1, 2)'] }, { code: 0, indent: 0, parameters: [] }])] },
    { id: 2, name: 'Branch', note: '', x: 1, y: 0, pages: [page([{ code: Cmd.If, indent: 0, parameters: [BranchType.Script, 'gold() > 5'] }, { code: 0, indent: 0, parameters: [] }])] },
    { id: 3, name: 'Operand', note: '', x: 2, y: 0, pages: [page([{ code: Cmd.ControlVariables, indent: 0, parameters: [1, 1, 0, 4, 'level()'] }, { code: 0, indent: 0, parameters: [] }])] },
    { id: 4, name: 'Plain', note: '', x: 0, y: 1, pages: [page([{ code: Cmd.ControlVariables, indent: 0, parameters: [1, 1, 0, 0, 5] }, { code: 0, indent: 0, parameters: [] }])] },
  ] as typeof map.events;
  const scripts: string[] = [];
  convertMap(exportMap(map), 1, () => undefined, new Map(), scripts);
  assert.deepEqual(scripts, ['Script', 'Branch', 'Operand']);
});

// --- Project import through the API ---------------------------------------------------------

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
  for (const f of ['img/tilesets/ImportTest_A2.png', 'img/characters/ImportHero.png']) {
    const full = join(PATHS.uploads, f);
    if (existsSync(full)) rmSync(full);
  }
});

test('an administrator imports a zipped project: tilesets, tree, maps, resources and a report', async () => {
  const client = new TestClient(server.url);
  await client.post('/register', {
    _csrf: await client.csrf('/register'),
    username: 'Importer',
    email: 'importer@example.com',
    password: 'secret password',
    passwordConfirm: 'secret password',
  });
  const csrf = await client.csrf('/characters');

  const flags = new Array(8192).fill(0);
  flags[TILE_ID_A2] = 0x0f;
  const map = (displayName: string, events: unknown[]) => ({
    width: 3, height: 2, tilesetId: 7, displayName, data: new Array(3 * 2 * 6).fill(0).map((_, i) => (i < 6 ? TILE_ID_A2 : 0)),
    events, bgm: { name: '', volume: 90, pitch: 100, pan: 0 }, parallaxName: '', note: '', encounterList: [], battleback1Name: '',
  });
  const page = (list: unknown[]) => ({ ...createPage(), list });
  const zip = makeZip({
    'MyGame/data/Tilesets.json': JSON.stringify([null, { id: 7, name: 'Imported', mode: 1, tilesetNames: ['', 'ImportTest_A2', '', '', '', '', '', '', ''], flags, note: '' }]),
    'MyGame/data/MapInfos.json': JSON.stringify([null, { id: 1, name: 'Town', parentId: 0, order: 1, expanded: true }, { id: 2, name: 'Cave', parentId: 1, order: 1, expanded: true }]),
    'MyGame/data/Map001.json': JSON.stringify(map('Town', [null, { id: 1, name: 'Door', note: '', x: 1, y: 1, pages: [page([
      { code: Cmd.TransferPlayer, indent: 0, parameters: [0, 2, 0, 0, 2, 0] },
      { code: 122, indent: 0, parameters: [1, 1, 0, 0, 5] },
      { code: 356, indent: 0, parameters: ['SomePlugin run'] },
      { code: 0, indent: 0, parameters: [] },
    ])] }])),
    'MyGame/data/Map002.json': JSON.stringify(map('Cave', [null])),
    'MyGame/data/Actors.json': '[]',
    'MyGame/img/tilesets/ImportTest_A2.png': fakePng(768, 576),
    'MyGame/img/characters/ImportHero.png': fakePng(576, 384),
    'MyGame/img/battlebacks1/Grass.png': fakePng(1000, 740),
  });
  const res = await client.request('/api/editor/import', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': csrf }, body: zip });
  assert.equal(res.status, 200);
  const { report } = (await res.json()) as { report: { maps: number; tilesets: number; images: number; warnings: { key: string; params?: Record<string, unknown> }[]; mapIds: Record<string, number> } };
  assert.equal(report.tilesets, 1);
  assert.equal(report.maps, 2);
  assert.equal(report.images, 2);
  const keys = report.warnings.map((w) => w.key);
  assert.ok(keys.includes('import.warning.unsupported_command'));
  assert.ok(keys.includes('import.warning.plugin_command'));
  assert.ok(keys.includes('import.warning.folder_ignored'));
  assert.ok(keys.includes('import.warning.database_file'));

  const town = server.ctx.maps.get(report.mapIds[1]!)!;
  const cave = server.ctx.maps.info(report.mapIds[2]!)!;
  assert.equal(cave.parentId, report.mapIds[1], 'the tree structure is kept');
  const transfer = town.events[1]!.pages[0]!.list[0]!;
  assert.equal(transfer.parameters[1], report.mapIds[2], 'transfers point to the new map id');
  const tileset = server.ctx.gameData.get('tileset', town.tilesetId)!;
  assert.equal(tileset.name, 'Imported');
  assert.equal(tileset.flags[TILE_ID_A2], 0x0f);
  assert.equal(tileAt(town, 0, 0, 0), TILE_ID_A2);
  assert.ok(server.ctx.resources.all().some((r) => r.id === 'tilesets/ImportTest_A2' && r.origin === 'uploaded'));

  // Export of the imported map.
  const exported = await client.request(`/api/editor/maps/${report.mapIds[1]}/export`);
  assert.match(exported.headers.get('content-disposition') ?? '', /Map\d{3}\.json/);
  assert.equal(((await exported.json()) as { displayName: string }).displayName, 'Town');
});

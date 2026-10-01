/**
 * @file Bundles the browser client with esbuild.
 *
 * Entry points (TypeScript and CSS) are compiled into `public/build/`, which the
 * server exposes under `/build`. Pass `--watch` to rebuild on change (used by
 * `npm run dev`).
 */
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.env.NODE_ENV === 'production';

const options: esbuild.BuildOptions = {
  entryPoints: {
    home: 'client/pages/home.ts',
    'dev-assets': 'client/pages/dev-assets.ts',
    characters: 'client/pages/characters.ts',
    'character-new': 'client/pages/character-new.ts',
    admin: 'client/pages/admin.ts',
    game: 'client/main.ts',
    'game-style': 'client/styles/game.css',
    site: 'client/styles/site.css',
  },
  outdir: 'public/build',
  // Images referenced by CSS are served by the game server, not bundled.
  external: ['/img/*'],
  bundle: true,
  format: 'esm',
  // Code splitting: the map editor is only downloaded when an administrator opens it.
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  target: 'es2022',
  sourcemap: true,
  minify: production,
  logLevel: 'info',
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}

/**
 * @file Development runner: starts the esbuild watcher for the client and the
 * server under `tsx watch` (restarted on every server/shared change), and stops
 * both together on Ctrl+C.
 */
import { spawn, type ChildProcess } from 'node:child_process';

const children: ChildProcess[] = [];

function run(command: string, args: string[]): void {
  // `shell: true` resolves the npx shim on every platform.
  const child = spawn(command, args, { stdio: 'inherit', shell: true, env: { ...process.env, CARANILLE_DEV: '1' } });
  children.push(child);
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`[dev] "${command} ${args.join(' ')}" exited with ${code}`);
  });
}

run('npx', ['tsx', 'scripts/build-client.ts', '--watch']);
run('npx', ['tsx', 'watch', '--clear-screen=false', '--include', 'shared/**/*', 'server/index.ts']);

function stop(): void {
  for (const child of children) child.kill();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

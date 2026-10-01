/**
 * @file Server entry point.
 *
 * Boot sequence: read configuration -> open and migrate the SQLite database ->
 * build the Express app -> attach socket.io -> schedule automatic backups -> listen. On SIGINT/SIGTERM the
 * server stops accepting connections and closes the database cleanly so that
 * the WAL is checkpointed.
 */
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { closeContext, createContext } from './context.js';
import { createSocketServer } from './net/socket.js';
import { join } from 'node:path';
import { scheduleBackups } from './db/backups.js';
import { PATHS } from './paths.js';

const ctx = createContext(config);
const app = createApp(ctx);
const httpServer = createServer(app);
const io = createSocketServer(httpServer, ctx);
const stopBackups = config.dbPath === ':memory:' ? () => undefined : scheduleBackups(ctx.db, join(PATHS.data, 'backups'), config.backupHours, config.backupKeep);

httpServer.listen(config.port, config.host, () => {
  const shownHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`[caranille] listening on http://${shownHost}:${config.port} (db: ${config.dbPath})`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  stopBackups();
  console.log(`[caranille] ${signal} received, shutting down`);
  void io.close();
  httpServer.close(() => {
    closeContext(ctx);
    process.exit(0);
  });
  // Do not hang forever on lingering keep-alive connections.
  setTimeout(() => {
    closeContext(ctx);
    process.exit(0);
  }, 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

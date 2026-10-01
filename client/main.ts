/**
 * @file Entry point of the game client (page `/game`).
 *
 * Boot sequence: load the resource manifest, apply the window skin and icon
 * sheet, connect to the server with socket.io (the session cookie authenticates
 * the connection and designates the played character), then wait for
 * `enterWorld` and start the game.
 */
import { io, type Socket } from 'socket.io-client';
import { PROTOCOL_VERSION, type ClientToServerEvents, type EnterWorldPayload, type ServerToClientEvents } from '../shared/protocol.js';
import { AssetStore } from './engine/assets.js';
import { Game } from './game.js';
import { t, tDynamic } from './i18n.js';
import { applyIconSet, applyWindowSkin } from './ui/skin.js';

/** Typed client socket. */
export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const root = document.getElementById('game-root')!;
let game: Game | null = null;

function showMessage(text: string, withBackLink = false): void {
  const box = document.createElement('div');
  box.className = 'boot-message';
  box.textContent = text;
  if (withBackLink) {
    const link = document.createElement('a');
    link.href = '/characters';
    link.textContent = t('game.back_to_characters');
    box.append(document.createElement('br'), link);
  }
  if (game) root.append(box);
  else root.replaceChildren(box);
}

async function boot(): Promise<void> {
  const assets = new AssetStore();
  await assets.init();
  const skin = await assets.image('system', 'Window');
  if (skin) applyWindowSkin(skin);
  const iconUrl = assets.url('system', 'IconSet');
  if (iconUrl) applyIconSet(iconUrl);

  // Automatic reconnection after network drops; the server keeps the session, so
  // it simply sends `enterWorld` again and the game resynchronises.
  const socket: GameSocket = io({ transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: 20, reconnectionDelayMax: 5000 });
  socket.on('connect_error', (err) => {
    // Authentication problems are final; network errors are retried by socket.io.
    if (err.message.startsWith('error.')) {
      socket.disconnect();
      showMessage(tDynamic(err.message), true);
    }
  });
  socket.on('errorMessage', (e) => {
    if (!game) showMessage(tDynamic(e.key, e.params), true);
  });
  socket.on('disconnect', (reason) => {
    // The server closed the connection on purpose (replaced session, kick): no retry.
    if (reason === 'io server disconnect') showMessage(t('game.disconnected'), true);
  });
  // A tab left open across a server update would speak an outdated protocol:
  // reload it to fetch the new client.
  socket.on('welcome', (w) => {
    if (w.protocol !== PROTOCOL_VERSION) location.reload();
  });
  socket.io.on('reconnect_failed', () => showMessage(t('game.disconnected'), true));
  // Events sent right after `enterWorld` (inventory, journal, skills, first
  // effects) arrive while the map is still loading, before the game listens:
  // keep them and hand them to the game once it is ready.
  const early: [string, unknown[]][] = [];
  const keepEarly = (event: string, ...args: unknown[]) => {
    if (!game && event !== 'enterWorld') early.push([event, args]);
  };
  socket.onAny(keepEarly);
  socket.on('enterWorld', (payload: EnterWorldPayload) => {
    if (game) {
      void game.reenter(payload);
      return;
    }
    Game.start(root, socket, assets, payload)
      .then((g) => {
        game = g;
        socket.offAny(keepEarly);
        for (const [event, args] of early.splice(0)) {
          for (const listener of socket.listeners(event as 'inventory')) (listener as (...a: unknown[]) => void)(...args);
        }
      })
      .catch((err: unknown) => {
        console.error(err);
        showMessage(t('game.load_error'), true);
      });
  });
}

boot().catch((err: unknown) => {
  console.error(err);
  showMessage(t('game.load_error'), true);
});

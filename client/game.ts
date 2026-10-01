/**
 * @file The running game: owns the canvas, the main loop, the map scene, the
 * player controller and the interface, and connects them to the server.
 *
 * Main loop: fixed 60 Hz updates (movement and animations are frame-based, so
 * they run at the same speed on every screen) and one render per display frame.
 * Each update routes input in priority order: message window, then the top
 * interface window, then the map (menu key, movement, action).
 *
 * Rendering: the canvas covers the whole viewport at device resolution; the
 * zoom (automatic or chosen in the options) is an integer factor so pixel art
 * stays sharp, and image smoothing is disabled.
 */
import type { EffectPayload, EnterWorldPayload, EventUpdate, MapChangePayload, MapPayload, MessagePayload, PlayerCharacterInfo } from '../shared/protocol.js';
import type { Direction } from '../shared/settings.js';
import type { AssetStore } from './engine/assets.js';
import { UiAudio } from './engine/audio.js';
import { Input } from './engine/input.js';
import { PlayerController } from './engine/player-controller.js';
import { MapScene } from './engine/scene.js';
import { onLocaleChange, t, tDynamic } from './i18n.js';
import type { GameSocket } from './main.js';
import { el } from './ui/dom.js';
import { Hud, type HotbarDrop, type MenuButton, type TargetInfo } from './ui/hud.js';
import { BagWindow } from './ui/bag.js';
import { AdminWindow, MainMenu, MapWindow, OptionsWindow, type MenuHost } from './ui/menus.js';
import { EquipmentWindow, StatusWindow } from './ui/character.js';
import { BankWindow, ShopWindow } from './ui/commerce.js';
import type { SheetPayload } from '../shared/character.js';
import type { EquipSlot, ParamName } from '../shared/database.js';
import { MessageWindow } from './ui/message.js';
import { QuestLog, QuestTracker, QuestWindow } from './ui/quests.js';
import { SkillsWindow } from './ui/skills.js';
import { ChatBox } from './ui/chat.js';
import { ChoiceWindow, FriendsWindow, InspectWindow, TradeWindow } from './ui/social.js';
import { GuildWindow, PartyWindow } from './ui/guild.js';
import { HOTBAR_SIZE, type HotbarSlot, type SkillsPayload } from '../shared/combat.js';
import { MAX_REPORT_LENGTH } from '../shared/social.js';
import type { InventoryPayload } from '../shared/protocol.js';
import { TouchControls, fullscreenSupported, isFullscreen, toggleFullscreen } from './ui/mobile.js';
import { OptionsStore } from './ui/options.js';
import { WindowManager, setWindowStorageKey } from './ui/windows.js';

const FRAME_MS = 1000 / 60;

/** The game client once the world has been entered. */
export class Game implements MenuHost {
  private readonly canvas: HTMLCanvasElement;
  /** Black overlay used for map transitions. */
  private readonly fade: HTMLDivElement;
  /** The screen was faded out by an event and stays black until it fades in again. */
  private screenFaded = false;
  /** Screen tone layers (darkening and lightening) and flash layer. */
  private readonly tintDark: HTMLDivElement;
  private readonly tintLight: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  /** Screen shake in progress. */
  private shake: { until: number; power: number; speed: number } | null = null;
  private readonly questLog: QuestLog;
  /** Known skills and hotbar (from the server). */
  private skills: SkillsPayload = { skills: [], hotbar: [], cooldowns: {} };
  /** Time each skill is ready again, and its full cooldown (for the gauges). */
  private readonly cooldowns = new Map<number, { end: number; total: number }>();
  private inventory: InventoryPayload = { gold: 0, entries: [] };
  /** Knocked-out veil while waiting to reappear. */
  private deathOverlay: HTMLElement | null = null;
  private lastAttack = 0;
  private readonly chat: ChatBox;
  /** Chat bubbles above characters: character id → text and end time. */
  private readonly bubbles = new Map<number, { text: string; until: number }>();
  /** A map change is loading: the player cannot move. */
  private transferring = false;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly input = new Input();
  private readonly audio = new UiAudio();
  private readonly windows: WindowManager;
  private readonly hud: Hud;
  private readonly message: MessageWindow;
  private readonly touch: TouchControls;
  private readonly options: OptionsStore;
  private readonly controller: PlayerController;
  private readonly menus: {
    main: MainMenu; status: StatusWindow; map: MapWindow; options: OptionsWindow; admin: AdminWindow; bag: BagWindow; quests: QuestWindow; skills: SkillsWindow;
    equipment: EquipmentWindow; shop: ShopWindow; bank: BankWindow;
    friends: FriendsWindow; trade: TradeWindow; choice: ChoiceWindow; inspect: InspectWindow; party: PartyWindow; guild: GuildWindow;
  };
  private guildTag = '';
  /** Monster or player selected (target frame). */
  private target: { kind: 'monster' | 'player'; id: number } | null = null;
  private sheet: SheetPayload | null = null;
  private friendNames: string[] = [];
  private system: EnterWorldPayload['system'];
  private currencyName: string;
  private character: PlayerCharacterInfo;
  private readonly role: EnterWorldPayload['role'];
  private readonly startedAt = Date.now();
  private zoom = 1;
  private dpr = 1;
  private accumulator = 0;
  private lastTime = 0;
  /** Time of the last animation frame callback, for the stall watchdog. */
  private lastRaf = 0;

  private constructor(
    root: HTMLElement,
    private readonly socket: GameSocket,
    private readonly assets: AssetStore,
    private scene: MapScene,
    payload: EnterWorldPayload,
  ) {
    this.character = payload.character;
    this.role = payload.role;
    this.currencyName = payload.system.currencyName;
    this.system = payload.system;
    this.guildTag = payload.character.guildTag ?? '';
    setWindowStorageKey(this.character.id);
    this.options = new OptionsStore(this.character.id);

    this.canvas = el('canvas', { className: 'game-canvas', attrs: { 'aria-label': t('game.canvas_label') } });
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    const uiLayer = el('div', { className: 'ui-layer' });
    const windowLayer = el('div', { className: 'window-layer' });
    this.fade = el('div', { className: 'fade-overlay' });
    this.tintDark = el('div', { className: 'screen-tint dark' });
    this.tintLight = el('div', { className: 'screen-tint light' });
    this.flash = el('div', { className: 'screen-flash' });
    root.replaceChildren(this.canvas, this.tintDark, this.tintLight, this.flash, uiLayer, this.fade);
    this.questLog = new QuestLog(this.character.id);

    this.hud = new Hud(uiLayer, () => this.openMap());
    this.message = new MessageWindow(uiLayer, this.audio);
    this.touch = new TouchControls(uiLayer, this.input, {
      onMenu: () => this.toggleMainMenu(),
      onFullscreen: () => this.toggleFullscreen(),
      onChat: () => this.chat.toggle(),
    });
    this.chat = new ChatBox(uiLayer, {
      send: (text, channel) => this.socket.emit('chat', text, channel),
      emote: (balloon) => this.socket.emit('emote', balloon),
      typing: (active) => this.input.setSuspended(active),
      knownNames: () => [...new Set([...[...this.scene.remotes.values()].map((r) => r.info.name), ...this.friendNames])],
      addFriend: (name) => this.socket.emit('friendAdd', name),
      ignore: (name) => this.socket.emit('ignore', name),
      trade: (id) => this.socket.emit('tradeRequest', id),
      inviteParty: (id) => this.socket.emit('partyInvite', id),
      inviteGuild: (id) => this.socket.emit('guildInvite', id),
      inspect: (id) => this.socket.emit('inspect', id),
      report: (id, name) => this.reportPlayer(id, name),
      selfId: () => this.character.id,
    });
    uiLayer.append(windowLayer);
    this.windows = new WindowManager(windowLayer, this.audio, () => this.refreshFreeze());
    this.menus = {
      main: new MainMenu(this),
      status: new StatusWindow(this.sheetHost()),
      map: new MapWindow(() => this.hud.bigMap(), () => this.scene.map.displayName),
      options: new OptionsWindow(this.options, this, () => this.refreshLanguage()),
      admin: new AdminWindow(() => void this.openEditor()),
      bag: new BagWindow({
        use: (id) => this.socket.emit('useItem', id),
        equip: (e) => e.slot && this.socket.emit('equip', e.slot, e.id),
        discard: (e, n) => this.socket.emit('discard', e.kind, e.id, n),
        currencyName: () => this.currencyName,
        paramName: (p) => this.paramName(p),
        sellRate: () => this.system.sellRate,
        bagSize: () => this.system.bagSize,
        linkInChat: (name) => {
          this.windows.closeAll();
          this.chat.insert(`[${name}]`);
        },
      }),
      equipment: new EquipmentWindow(this.sheetHost()),
      shop: new ShopWindow(this.commerceHost()),
      bank: new BankWindow(this.commerceHost()),
      friends: new FriendsWindow({
        whisper: (name) => this.chat.focus(`/w ${name} `),
        addFriend: (name) => this.socket.emit('friendAdd', name),
        removeFriend: (id) => this.socket.emit('friendRemove', id),
        unignore: (id) => this.socket.emit('unignore', id),
      }),
      trade: new TradeWindow({
        inventory: () => this.inventory,
        currencyName: () => this.currencyName,
        offer: (items, gold) => this.socket.emit('tradeOffer', { items, gold }),
        lock: () => this.socket.emit('tradeLock'),
        confirm: () => this.socket.emit('tradeConfirm'),
        cancel: () => this.socket.emit('tradeCancel'),
      }),
      choice: new ChoiceWindow('choice'),
      inspect: new InspectWindow(),
      party: new PartyWindow({
        selfId: () => this.character.id,
        inviteByName: (name) => this.socket.emit('chat', `/invite ${name}`, 'map'),
        leave: () => this.socket.emit('partyLeave'),
        kick: (id) => this.socket.emit('partyKick', id),
        promote: (id) => this.socket.emit('partyPromote', id),
        loot: (mode) => this.socket.emit('partyLoot', mode),
        raid: (raid) => this.socket.emit('partyRaid', raid),
      }),
      guild: new GuildWindow({
        selfId: () => this.character.id,
        inventory: () => this.inventory,
        currencyName: () => this.currencyName,
        creationCost: () => this.system.guildCreationCost,
        create: (name, tag, emblem) => this.socket.emit('guildCreate', name, tag, emblem),
        inviteByName: (name) => this.socket.emit('chat', `/ginvite ${name}`, 'map'),
        leave: () => this.socket.emit('guildLeave'),
        kick: (id) => this.socket.emit('guildKick', id),
        setRank: (id, rank) => this.socket.emit('guildSetRank', id, rank),
        editRank: (rank, name, permissions) => this.socket.emit('guildEditRank', rank, name, permissions),
        motd: (text) => this.socket.emit('guildMotd', text),
        bank: (kind, id, quantity, deposit) => this.socket.emit('guildBank', kind, id, quantity, deposit),
        gold: (amount) => this.socket.emit('guildGold', amount),
      }),
      quests: new QuestWindow(this.questLog),
      skills: new SkillsWindow({
        skills: () => this.skills,
        inventory: () => this.inventory,
        setHotbar: (slots) => this.saveHotbar(slots),
        useSkill: (id) => this.useSkill(id),
      }),
    };
    this.hud.addSidePanel(new QuestTracker(this.questLog, () => this.openQuests()).element);
    this.controller = new PlayerController(scene, this.input, {
      move: (d, epoch) => this.socket.emit('move', d, epoch),
      turn: (d) => this.socket.emit('turn', d),
      action: () => this.socket.emit('action'),
    });

    this.buildMenuBar();
    this.hud.setPlayer(this.character);
    this.enterScene(scene);
    this.bindSocket();
    this.bindPointer();
    this.bindShortcuts();
    this.options.onChange((o) => {
      this.audio.volume = o.volume;
      this.touch.apply(o);
      this.chat.applyOptions(o);
      this.resize();
    });
    this.audio.volume = this.options.values.volume;
    this.touch.apply(this.options.values);
    this.chat.applyOptions(this.options.values);
    onLocaleChange(() => this.refreshLanguage());
    window.addEventListener('resize', () => this.resize());
    this.resize();
    const unlock = () => this.audio.unlock();
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });
    requestAnimationFrame((time) => this.loop(time));
    // Some browsers stop animation frames in occluded windows or embedded views;
    // keep the simulation (and its server intents) ticking with a timer then.
    window.setInterval(() => {
      const now = performance.now();
      if (now - this.lastRaf > 200) this.frame(now);
    }, 50);
  }

  /**
   * Loads the first map and starts the game.
   * @param root - Container element.
   * @param socket - Connected socket.
   * @param assets - Asset store (manifest loaded).
   * @param payload - `enterWorld` payload.
   */
  static async start(root: HTMLElement, socket: GameSocket, assets: AssetStore, payload: EnterWorldPayload): Promise<Game> {
    const scene = await Game.loadScene(assets, payload, payload.character.appearance);
    return new Game(root, socket, assets, scene, payload);
  }

  /** Loads a map scene with its events, the other players and the monsters. */
  private static async loadScene(assets: AssetStore, payload: MapPayload, appearance: PlayerCharacterInfo['appearance']): Promise<MapScene> {
    const scene = await MapScene.load(assets, payload.map, payload.tileset, payload.events, appearance, 48);
    for (const remote of payload.players) scene.addRemote(remote);
    await Promise.all(payload.monsters.map((m) => scene.addMonster(m)));
    return scene;
  }

  private enterScene(scene: MapScene, announce = true): void {
    this.scene = scene;
    const c = this.character;
    scene.player.locate(Math.min(c.x, scene.map.width - 1), Math.min(c.y, scene.map.height - 1));
    scene.player.direction = c.direction;
    this.controller.setScene(scene);
    this.hud.setMinimapMap(scene);
    if (announce) this.hud.showMapName(scene.map.displayName);
    this.resize();
  }

  /**
   * Switches to another map (teleport) with a fade to black.
   * @param payload - New map, position and movement epoch.
   */
  private async changeMap(payload: MapChangePayload): Promise<void> {
    this.transferring = true;
    this.refreshFreeze();
    const fade = payload.fade !== 2;
    this.fade.classList.toggle('white', payload.fade === 1);
    if (fade) {
      this.fade.classList.add('visible');
      await new Promise((r) => window.setTimeout(r, 220));
    }
    try {
      const sameMap = payload.map.id === this.scene.map.id;
      const scene = sameMap ? this.scene : await Game.loadScene(this.assets, payload, this.character.appearance);
      this.character = { ...this.character, mapId: payload.map.id, x: payload.x, y: payload.y, direction: payload.direction };
      if (sameMap) {
        this.scene.remotes.clear();
        for (const remote of payload.players) this.scene.addRemote(remote);
        this.scene.monsters.clear();
        await Promise.all(payload.monsters.map((m) => this.scene.addMonster(m)));
      } else {
        this.enterScene(scene);
      }
      this.controller.reject(payload.x, payload.y, payload.direction, payload.epoch);
    } finally {
      this.setDead(0);
      // A screen faded out by an event stays black until the event fades it in.
      if (!this.screenFaded) this.fade.classList.remove('visible');
      this.transferring = false;
      this.refreshFreeze();
    }
  }

  /**
   * Re-synchronises after a reconnection (the server sends `enterWorld` again).
   * @param payload - Fresh world state.
   */
  async reenter(payload: EnterWorldPayload): Promise<void> {
    this.character = payload.character;
    this.screenFaded = false;
    this.applyTint([0, 0, 0, 0], 0);
    this.hud.setPlayer(this.character);
    await this.changeMap({ ...payload, x: payload.character.x, y: payload.character.y, direction: payload.character.direction, epoch: 0, fade: 2 });
    this.hud.notify(t('game.reconnected'), 'check');
  }

  // --- MenuHost -------------------------------------------------------------

  player(): PlayerCharacterInfo {
    return { ...this.character, x: this.scene.player.x, y: this.scene.player.y, direction: this.scene.player.direction };
  }

  playTimeSeconds(): number {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  openBag(): void {
    this.windows.open(this.menus.bag);
  }

  openQuests(): void {
    this.windows.open(this.menus.quests);
  }

  openSkills(): void {
    this.windows.open(this.menus.skills);
  }

  currency(): string {
    return this.currencyName;
  }

  openEquipment(): void {
    this.windows.open(this.menus.equipment);
  }

  /** Name of a parameter (System terms). */
  private paramName(p: string): string {
    return this.system.params[p as keyof EnterWorldPayload['system']['params']] || p.toUpperCase();
  }

  private sheetHost() {
    return {
      player: () => this.player(),
      sheet: () => this.sheet,
      inventory: () => this.inventory,
      paramName: (p: string) => this.paramName(p),
      allocate: (p: ParamName) => this.socket.emit('allocate', p),
      equip: (slot: EquipSlot, id: number) => this.socket.emit('equip', slot, id),
    };
  }

  private commerceHost() {
    return {
      inventory: () => this.inventory,
      sheet: () => this.sheet,
      currencyName: () => this.currencyName,
      paramName: (p: string) => this.paramName(p),
      buy: (index: number, quantity: number) => this.socket.emit('shopBuy', index, quantity),
      sell: (e: { kind: 'item' | 'weapon' | 'armor'; id: number }, quantity: number) => this.socket.emit('shopSell', e.kind, e.id, quantity),
      bankMove: (e: { kind: 'item' | 'weapon' | 'armor'; id: number }, quantity: number, toBank: boolean) => this.socket.emit('bankMove', e.kind, e.id, quantity, toBank),
      bankGold: (amount: number) => this.socket.emit('bankGold', amount),
    };
  }

  openStatus(): void {
    this.windows.open(this.menus.status);
  }

  openOptions(): void {
    this.windows.open(this.menus.options);
  }

  openMap(): void {
    this.windows.open(this.menus.map);
  }

  openWindow(id: 'friends' | 'guild' | 'party' | 'admin'): void {
    this.hud.setBadge(id, false);
    this.windows.open(this.menus[id]);
  }

  isAdmin(): boolean {
    return this.role === 'admin';
  }

  logout(): void {
    this.socket.disconnect();
    window.location.href = '/characters';
  }

  /** Opens the map editor over the game (administrators only; the server checks every request). */
  private async openEditor(): Promise<void> {
    if (this.role !== 'admin' || document.body.classList.contains('editor-open')) return;
    this.windows.closeAll();
    this.input.setSuspended(true);
    const { MapEditorApp } = await import('./editor/editor.js');
    try {
      await MapEditorApp.open({
        container: document.getElementById('game-root')!,
        csrf: document.getElementById('game-root')!.dataset.csrf ?? '',
        assets: this.assets,
        startMapId: this.scene.map.id,
        onClose: () => this.input.setSuspended(false),
      });
    } catch (err) {
      console.error(err);
      this.input.setSuspended(false);
      this.hud.notify(t('game.load_error'), 'info');
    }
  }

  isFullscreen(): boolean {
    return isFullscreen();
  }

  toggleFullscreen(): void {
    toggleFullscreen(() => this.hud.notify(t('touch.ios_hint'), 'info'));
  }

  // --- Interface ------------------------------------------------------------

  private toggleMainMenu(): void {
    if (this.message.active) return;
    if (this.windows.hasOpen) this.windows.closeAll();
    else this.windows.open(this.menus.main);
    this.audio.play(this.windows.hasOpen ? 'ok' : 'cancel');
  }

  private buildMenuBar(): void {
    const buttons: MenuButton[] = [
      { id: 'bag', icon: 'bag', labelKey: 'hud.menu.bag', shortcut: 'I', enabled: true, onClick: () => this.windows.toggle(this.menus.bag) },
      { id: 'character', icon: 'character', labelKey: 'hud.menu.character', shortcut: 'C', enabled: true, onClick: () => this.windows.toggle(this.menus.status) },
      { id: 'skills', icon: 'skills', labelKey: 'hud.menu.skills', shortcut: 'K', enabled: true, onClick: () => this.windows.toggle(this.menus.skills) },
      { id: 'quests', icon: 'quests', labelKey: 'hud.menu.quests', shortcut: 'J', enabled: true, onClick: () => this.windows.toggle(this.menus.quests) },
      { id: 'friends', icon: 'friends', labelKey: 'hud.menu.friends', shortcut: 'L', enabled: true, onClick: () => this.windows.toggle(this.menus.friends) },
      { id: 'guild', icon: 'guild', labelKey: 'hud.menu.guild', shortcut: 'G', enabled: true, onClick: () => this.windows.toggle(this.menus.guild) },
      { id: 'party', icon: 'party', labelKey: 'hud.menu.party', shortcut: 'P', enabled: true, onClick: () => this.windows.toggle(this.menus.party) },
      { id: 'map', icon: 'map', labelKey: 'hud.menu.map', shortcut: 'M', enabled: true, onClick: () => this.windows.toggle(this.menus.map) },
      { id: 'options', icon: 'options', labelKey: 'hud.menu.options', shortcut: 'O', enabled: true, onClick: () => this.windows.toggle(this.menus.options) },
    ];
    if (this.role === 'admin') {
      buttons.push({ id: 'admin', icon: 'admin', labelKey: 'hud.menu.admin', enabled: true, onClick: () => this.windows.toggle(this.menus.admin) });
    }
    // Opening a window clears the badge of its button.
    for (const b of buttons) {
      const click = b.onClick;
      b.onClick = () => {
        this.hud.setBadge(b.id, false);
        click?.();
      };
    }
    this.hud.setMenu(buttons);
  }

  private refreshLanguage(): void {
    this.hud.refreshLabels();
    this.chat.refreshLabels();
    this.hud.setPlayer(this.character);
    this.buildMenuBar();
    this.canvas.setAttribute('aria-label', t('game.canvas_label'));
  }

  private refreshFreeze(): void {
    this.controller.frozen = this.windows.hasOpen || this.message.active || this.transferring;
    this.hud.setDimmed(this.message.active);
  }

  // --- Network --------------------------------------------------------------

  private bindSocket(): void {
    this.socket.on('moveRejected', ({ x, y, direction, epoch }) => this.controller.reject(x, y, direction, epoch));
    this.socket.on('eventUpdate', (u: EventUpdate) => {
      if (u.view === null) {
        this.scene.removeEvent(u.id);
        return;
      }
      if (u.view) {
        void this.scene.updateEvent(u.view);
        return;
      }
      const e = this.scene.events.get(u.id);
      if (!e) return;
      if (u.direction) e.character.direction = u.direction;
      if (u.x !== undefined && u.y !== undefined) {
        const c = e.character;
        // Finish the previous step first so that steps never blend diagonally.
        c.realX = c.x;
        c.realY = c.y;
        if (Math.abs(c.x - u.x) + Math.abs(c.y - u.y) === 1) {
          c.x = u.x;
          c.y = u.y;
        } else {
          c.locate(u.x, u.y);
        }
        e.view = { ...e.view, x: u.x, y: u.y };
      }
    });
    this.socket.on('eventsChanged', ({ views, removed }) => {
      for (const id of removed) this.scene.removeEvent(id);
      for (const view of views) void this.scene.updateEvent(view);
    });
    this.socket.on('forceMove', ({ x, y, direction, epoch }) => this.controller.force(x, y, direction, epoch));
    this.socket.on('effect', (effect) => void this.playEffect(effect));
    this.socket.on('showMessage', (payload: MessagePayload, ack) => {
      void this.showMessage(payload).then((answer) => ack(answer));
    });
    this.socket.on('quests', (journal) => this.questLog.set(journal));
    this.socket.on('inventory', (inventory) => {
      this.character = { ...this.character, gold: inventory.gold };
      this.inventory = inventory;
      this.menus.bag.setInventory(inventory);
      this.refreshHotbar();
      this.menus.skills.refresh();
      this.menus.equipment.refresh();
      this.menus.shop.refresh();
      this.menus.bank.update();
      this.menus.guild.refresh();
    });
    this.socket.on('sheet', (sheet) => {
      this.sheet = sheet;
      this.menus.status.refresh();
      this.menus.equipment.refresh();
    });
    this.socket.on('shopOpen', (payload, ack) => {
      this.menus.shop.show(payload, () => ack());
      this.windows.open(this.menus.shop);
    });
    this.socket.on('bankOpen', (payload, ack) => {
      this.menus.bank.show(payload, () => ack());
      this.windows.open(this.menus.bank);
    });
    this.socket.on('bank', (payload) => this.menus.bank.update(payload));
    this.socket.on('chat', (message) => {
      this.chat.add(message);
      // Map messages also appear as bubbles above the writer.
      if (message.channel === 'map' && message.from && !message.action) this.bubbles.set(message.from.id, { text: message.text, until: performance.now() + 4000 + message.text.length * 40 });
      if (message.channel === 'private' && message.from?.id !== this.character.id) {
        this.audio.play('ok');
        this.hud.setBadge('friends', true);
      }
    });
    this.socket.on('inspect', (data) => {
      this.menus.inspect.set(data);
      this.windows.open(this.menus.inspect);
    });
    this.socket.on('friends', (data) => {
      this.friendNames = data.friends.map((f) => f.name);
      this.menus.friends.set(data);
    });
    this.socket.on('emote', ({ id, balloon }) => {
      const who = this.scene.combatant({ kind: 'player', id }, this.character.id);
      if (who) this.scene.showBalloon(-1, balloon, who);
    });
    this.socket.on('tradeRequest', ({ id, name }) => {
      this.menus.choice.ask(t('trade.title'), t('trade.request', { name }), [
        { label: t('trade.accept'), icon: 'check', onSelect: () => this.socket.emit('tradeRespond', true) },
        { label: t('trade.decline'), icon: 'close', onSelect: () => this.socket.emit('tradeRespond', false) },
      ]);
      this.windows.open(this.menus.choice);
      void id;
    });
    this.socket.on('party', (view) => {
      this.menus.party.set(view);
      this.hud.setParty(view, this.character.id);
    });
    this.socket.on('guild', (view) => {
      this.menus.guild.set(view);
      this.guildTag = view?.tag ?? '';
    });
    this.socket.on('playerGuild', ({ id, tag }) => {
      if (id === this.character.id) this.guildTag = tag;
      const remote = this.scene.remotes.get(id);
      if (remote) remote.info = { ...remote.info, guild: tag || undefined };
    });
    // An invitation also lights the badge of its menu button until it is answered.
    const invitation = (badge: string, title: string, text: string, answer: (accept: boolean) => void) => {
      this.hud.setBadge(badge, true);
      const reply = (accept: boolean) => {
        this.hud.setBadge(badge, false);
        answer(accept);
      };
      this.menus.choice.ask(title, text, [
        { label: t('trade.accept'), icon: 'check', onSelect: () => reply(true) },
        { label: t('trade.decline'), icon: 'close', onSelect: () => reply(false) },
      ]);
      this.windows.open(this.menus.choice);
    };
    this.socket.on('partyInvite', ({ name }) => invitation('party', t('party.title'), t('party.invited_by', { name }), (a) => this.socket.emit('partyRespond', a)));
    this.socket.on('guildInvite', ({ name, guild }) => invitation('guild', t('guild.title'), t('guild.invited_by', { name, guild }), (a) => this.socket.emit('guildRespond', a)));
    this.socket.on('telegraph', ({ x, y, radius, ms }) => {
      this.scene.showTelegraph(x, y, radius, ms);
      this.audio.play('buzzer');
    });
    this.socket.on('lootRoll', ({ id, name, count, seconds }) => {
      const choose = (choice: 'need' | 'greed' | 'pass') => this.socket.emit('lootChoice', id, choice);
      this.menus.choice.ask(t('loot.title'), t('loot.question', { item: name, count, seconds }), [
        { label: t('loot.need'), icon: 'check', onSelect: () => choose('need') },
        { label: t('loot.greed'), icon: 'gold', onSelect: () => choose('greed') },
        { label: t('loot.pass'), icon: 'close', onSelect: () => choose('pass') },
      ]);
      this.windows.open(this.menus.choice);
    });
    this.socket.on('trade', (view) => {
      if (view && !this.windows.isOpen(this.menus.trade)) {
        this.menus.trade.set(view);
        this.windows.open(this.menus.trade);
      } else {
        this.menus.trade.set(view);
      }
    });
    this.socket.on('playerUpdate', (update) => {
      this.character = { ...this.character, ...update };
      this.hud.setPlayer(this.character);
      if (update.mp !== undefined) this.refreshHotbar();
      this.menus.status.refresh();
    });
    this.socket.on('skills', (payload) => {
      this.skills = payload;
      const now = performance.now();
      for (const [id, ms] of Object.entries(payload.cooldowns)) {
        const skill = payload.skills.find((s) => s.id === Number(id));
        this.cooldowns.set(Number(id), { end: now + ms, total: Math.max(ms, (skill?.cooldown ?? 0) * 1000) });
      }
      this.refreshHotbar();
      this.menus.skills.refresh();
    });
    this.socket.on('cooldown', ({ skillId, ms }) => this.cooldowns.set(skillId, { end: performance.now() + ms, total: ms }));
    this.socket.on('monsterSpawned', (m) => void this.scene.addMonster(m));
    this.socket.on('monsterRemoved', ({ id, died }) => this.scene.removeMonster(id, died));
    this.socket.on('monstersMoved', (moves) => {
      for (const [id, x, y, d] of moves) this.scene.moveMonster(id, x, y, d);
    });
    this.socket.on('combatAction', (action) => {
      const user = this.scene.combatant(action.actor, this.character.id);
      if (!user) return;
      this.autoTarget(action.actor, action.targets);
      if (action.actor.kind !== 'player' || action.actor.id !== this.character.id) user.direction = action.direction;
      if (action.animation) {
        const target = action.targets[0] ?? { x: user.x, y: user.y };
        void this.playEffect({ kind: 'animation', target: -1, ...action.animation }, { realX: target.x, realY: target.y });
      } else {
        this.scene.showAction(user, action);
        this.audio.play(action.skillId ? 'ok' : 'cursor');
      }
    });
    this.socket.on('damage', (views) => {
      for (const view of views) {
        const who = this.scene.combatant(view.target, this.character.id);
        if (who) this.scene.showDamage(who, view, this.options.values.showDamage);
        if (view.kind === 'hp_damage' && view.target.kind === 'player' && view.target.id === this.character.id) this.audio.play('buzzer');
      }
    });
    this.socket.on('playerDied', ({ seconds }) => this.setDead(seconds));
    this.socket.on('notify', (n) => {
      this.hud.notify(tDynamic(n.key, n.params), n.icon);
      this.audio.play(n.key.startsWith('error.') ? 'buzzer' : 'ok');
    });
    this.socket.on('playerJoined', (remote) => this.scene.addRemote(remote));
    this.socket.on('playerLeft', ({ id }) => this.scene.removeRemote(id));
    this.socket.on('playersMoved', (moves) => {
      for (const [id, x, y, d] of moves) if (id !== this.character.id) this.scene.moveRemote(id, x, y, d);
    });
    this.socket.on('mapChange', (payload) => void this.changeMap(payload));
    // Live edit from the editor: rebuild the map in place, keeping the player where it is.
    this.socket.on('mapUpdated', (payload) => {
      const p = this.scene.player;
      void Game.loadScene(this.assets, payload, this.character.appearance).then((scene) => {
        this.character = { ...this.character, x: p.x, y: p.y, direction: p.direction };
        this.enterScene(scene, false);
      });
    });
    this.socket.on('errorMessage', (e) => this.hud.notify(tDynamic(e.key, e.params), 'info'));
    this.socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') this.hud.notify(t('game.reconnecting'), 'info');
    });
  }

  private async showMessage(payload: MessagePayload): Promise<number> {
    const face = payload.faceName ? await this.assets.image('faces', payload.faceName) : null;
    const done = this.message.show(payload, face);
    this.refreshFreeze();
    const answer = await done;
    this.refreshFreeze();
    return answer;
  }

  /**
   * Screen colour tone: a multiplied layer darkens, a screen layer lightens,
   * and gray desaturates the map (the interface is not affected).
   */
  private applyTint(tone: [number, number, number, number], ms: number): void {
    const [r, g, b, gray] = tone;
    const duration = `${Math.max(0, ms)}ms`;
    for (const layer of [this.tintDark, this.tintLight]) layer.style.transitionDuration = duration;
    this.tintDark.style.backgroundColor = `rgb(${255 + Math.min(0, r)}, ${255 + Math.min(0, g)}, ${255 + Math.min(0, b)})`;
    this.tintLight.style.backgroundColor = `rgb(${Math.max(0, r)}, ${Math.max(0, g)}, ${Math.max(0, b)})`;
    this.canvas.style.transition = `filter ${duration}`;
    this.canvas.style.filter = gray > 0 ? `grayscale(${Math.round((gray / 255) * 100)}%)` : '';
  }

  /** Shows or hides the knocked-out veil (`seconds` 0 hides it). */
  private setDead(seconds: number): void {
    this.deathOverlay?.remove();
    this.deathOverlay = null;
    if (seconds <= 0) return;
    this.windows.closeAll();
    const counter = el('span', { text: String(seconds) });
    this.deathOverlay = el('div', { className: 'death-overlay' }, [
      el('div', { className: 'skin-window' }, [el('strong', { text: t('combat.knocked_out') }), el('span', { text: `${t('combat.respawn_in')} ` }), counter]),
    ]);
    this.canvas.parentElement?.append(this.deathOverlay);
    let left = seconds;
    const timer = window.setInterval(() => {
      left--;
      counter.textContent = String(Math.max(0, left));
      if (left <= 0 || !this.deathOverlay) window.clearInterval(timer);
    }, 1000);
  }

  /** Remaining cooldown fraction of a hotbar slot (0 = ready). */
  private slotCooldown(slot: HotbarSlot | undefined, now: number): number {
    if (slot?.kind !== 'skill') return 0;
    const c = this.cooldowns.get(slot.id);
    if (!c || now >= c.end) return 0;
    return (c.end - now) / Math.max(1, c.total);
  }

  /** Rebuilds the hotbar (desktop) and the skill buttons (touch screens). */
  private refreshHotbar(): void {
    const entries = Array.from({ length: 8 }, (_, i) => {
      const slot = this.skills.hotbar[i];
      if (!slot) return null;
      if (slot.kind === 'skill') {
        const skill = this.skills.skills.find((s) => s.id === slot.id);
        return skill ? { icon: skill.icon, label: skill.name, disabled: this.character.mp < skill.mpCost } : null;
      }
      const item = this.inventory.entries.find((e) => e.kind === 'item' && e.id === slot.id);
      return item ? { icon: item.icon, label: item.name, count: item.quantity, disabled: !item.usable } : null;
    });
    const use = (i: number) => this.useHotbar(i);
    this.hud.setHotbar(entries, use, (i, drop) => this.dropOnHotbar(i, drop));
    this.touch.setSkills(entries, use);
  }

  /** Uses the content of a hotbar slot. */
  private useHotbar(index: number): void {
    if (this.windows.hasOpen || this.message.active || this.deathOverlay) return;
    const slot = this.skills.hotbar[index];
    if (!slot) return;
    if (slot.kind === 'skill') this.useSkill(slot.id);
    else if (this.inventory.entries.some((e) => e.kind === 'item' && e.id === slot.id)) this.socket.emit('useItem', slot.id);
  }

  private useSkill(id: number): void {
    if (this.slotCooldown({ kind: 'skill', id }, performance.now()) > 0) {
      this.audio.play('buzzer');
      return;
    }
    this.socket.emit('useSkill', id);
  }

  /**
   * Drag and drop on the hotbar: a skill or item placed on a slot (and removed
   * from any other), two slots swapped, or a slot dragged out and emptied.
   */
  private dropOnHotbar(index: number, drop: HotbarDrop): void {
    const next = this.skills.hotbar.slice(0, HOTBAR_SIZE);
    while (next.length < HOTBAR_SIZE) next.push(null);
    if ('from' in drop) {
      if (drop.from < 0 || drop.from >= HOTBAR_SIZE || drop.from === index) return;
      if (index < 0) next[drop.from] = null;
      else [next[index], next[drop.from]] = [next[drop.from] ?? null, next[index] ?? null];
    } else if (index >= 0) {
      for (let i = 0; i < next.length; i++) if (next[i]?.kind === drop.slot.kind && next[i]?.id === drop.slot.id) next[i] = null;
      next[index] = drop.slot;
    }
    this.saveHotbar(next);
  }

  /** Saves a new hotbar (shown at once, stored by the server). */
  private saveHotbar(slots: HotbarSlot[]): void {
    this.skills = { ...this.skills, hotbar: slots };
    this.socket.emit('setHotbar', slots);
    this.refreshHotbar();
    this.menus.skills.refresh();
  }

  /** Normal attack (keyboard), at most every 250 ms (the server has its own attack delay). */
  private attack(): void {
    const now = performance.now();
    if (now - this.lastAttack < 250 || this.windows.hasOpen || this.message.active || this.deathOverlay) return;
    this.lastAttack = now;
    this.socket.emit('attack');
  }

  /** Plays an effect requested by an event (balloon, animation, sound, screen effects). */
  private async playEffect(effect: EffectPayload, anchor?: { realX: number; realY: number }): Promise<void> {
    if (effect.kind === 'balloon') {
      this.scene.showBalloon(effect.target, effect.balloon);
    } else if (effect.kind === 'animation') {
      const sheet = effect.sheet ? await this.assets.image('animations', effect.sheet) : null;
      this.scene.showAnimation(effect.target, sheet, effect.frameCount, effect.frameSize, effect.fps, anchor);
      const sound = effect.sound ? this.assets.url('se', effect.sound) : null;
      if (sound) this.audio.playFile(sound, 90, 100);
    } else if (effect.kind === 'se') {
      const url = this.assets.url('se', effect.name);
      if (url) this.audio.playFile(url, effect.volume, effect.pitch);
      else this.audio.play('ok');
    } else if (effect.kind === 'screenFade') {
      this.screenFaded = effect.out;
      this.fade.classList.remove('white');
      this.fade.style.transitionDuration = `${effect.ms}ms`;
      this.fade.classList.toggle('visible', effect.out);
      window.setTimeout(() => (this.fade.style.transitionDuration = ''), effect.ms);
    } else if (effect.kind === 'tint') {
      this.applyTint(effect.tone, effect.ms);
    } else if (effect.kind === 'flash') {
      const [r, g, b, a] = effect.color;
      const flash = this.flash;
      flash.style.transition = 'none';
      flash.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
      flash.style.opacity = String(a / 255);
      void flash.offsetWidth; // start the fade from the full colour
      flash.style.transition = `opacity ${effect.ms}ms linear`;
      flash.style.opacity = '0';
    } else if (effect.kind === 'shake') {
      this.shake = { until: performance.now() + effect.ms, power: effect.power, speed: effect.speed };
    } else {
      // Fade out and back in (inn...).
      this.fade.classList.remove('white');
      this.fade.classList.add('visible');
      await new Promise((r) => window.setTimeout(r, effect.ms / 2));
      if (!this.screenFaded) this.fade.classList.remove('visible');
    }
  }

  /** Horizontal offset of the screen shake at this frame, in CSS pixels. */
  private shakeOffset(): number {
    const shake = this.shake;
    if (!shake) return 0;
    const now = performance.now();
    if (now >= shake.until) {
      this.shake = null;
      return 0;
    }
    return Math.round(Math.sin((now / 1000) * shake.speed * 12) * shake.power * 1.5);
  }

  // --- Input ----------------------------------------------------------------

  private bindPointer(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.windows.hasOpen || this.message.active) return;
      const rect = this.canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) / this.zoom;
      const py = (e.clientY - rect.top) / this.zoom;
      const cell = this.scene.cellAt(px, py);
      if (!cell) return;
      // A click on a monster selects it (target frame).
      const monster = [...this.scene.monsters.values()].find((m) => !m.dying && m.character.x === cell.x && (m.character.y === cell.y || m.character.y === cell.y + 1));
      if (monster) {
        this.target = { kind: 'monster', id: monster.view.id };
        return;
      }
      // A click on another player selects it and offers the actions on it.
      const remote = [...this.scene.remotes.values()].find((r) => r.character.x === cell.x && (r.character.y === cell.y || r.character.y === cell.y + 1));
      if (remote) {
        this.target = { kind: 'player', id: remote.info.id };
        this.playerActions(remote.info.id, remote.info.name);
        return;
      }
      this.target = null;
      // Characters are taller than a cell: a click on the head of the one standing below targets it.
      const fraction = (py + this.scene.cameraY) / this.scene.tileSize - cell.y;
      const target = fraction > 0.5 && !this.scene.solidEventAt(cell.x, cell.y) && this.scene.solidEventAt(cell.x, cell.y + 1, true) ? { x: cell.x, y: cell.y + 1 } : cell;
      this.controller.walkTo(target.x, target.y);
    });
  }

  /** Actions on another player (clicked in the world). */
  private playerActions(id: number, name: string): void {
    this.menus.choice.ask(name, '', [
      { label: t('chat.menu.whisper'), icon: 'chat', onSelect: () => this.chat.focus(`/w ${name} `) },
      { label: t('chat.menu.trade'), icon: 'gold', onSelect: () => this.socket.emit('tradeRequest', id) },
      { label: t('chat.menu.friend'), icon: 'friends', onSelect: () => this.socket.emit('friendAdd', name) },
      { label: t('party.invite'), icon: 'party', onSelect: () => this.socket.emit('partyInvite', id) },
      { label: t('guild.invite'), icon: 'guild', onSelect: () => this.socket.emit('guildInvite', id) },
      { label: t('chat.menu.inspect'), icon: 'character', onSelect: () => this.socket.emit('inspect', id) },
      { label: t('chat.menu.ignore'), icon: 'close', onSelect: () => this.socket.emit('ignore', name) },
      { label: t('chat.menu.report'), icon: 'bell', onSelect: () => this.reportPlayer(id, name) },
    ]);
    this.windows.open(this.menus.choice);
  }

  /** Reports a player to the moderators, with a reason typed by the player. */
  private reportPlayer(id: number, name: string): void {
    const reason = window.prompt(t('chat.report_prompt', { name }), '')?.trim();
    if (reason) this.socket.emit('report', id, reason.slice(0, MAX_REPORT_LENGTH));
  }

  private bindShortcuts(): void {
    // Enter opens the chat input (it still confirms dialogues and windows).
    window.addEventListener(
      'keydown',
      (e) => {
        if ((e.code !== 'Enter' && e.code !== 'NumpadEnter') || this.chat.typing || this.message.active || this.windows.hasOpen) return;
        if (document.body.classList.contains('editor-open') || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.chat.focus();
      },
      { capture: true },
    );
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      if (e.ctrlKey || e.metaKey || e.altKey || this.message.active || document.body.classList.contains('editor-open')) return;
      // Holding the attack key keeps attacking.
      if (e.code === 'KeyF') {
        this.attack();
        return;
      }
      if (e.repeat) return;
      const digit = /^Digit([1-8])$/.exec(e.code);
      if (digit) {
        this.useHotbar(Number(digit[1]) - 1);
        return;
      }
      if (e.code === 'KeyC') this.windows.toggle(this.menus.status);
      else if (e.code === 'KeyM') this.windows.toggle(this.menus.map);
      else if (e.code === 'KeyI') this.windows.toggle(this.menus.bag);
      else if (e.code === 'KeyJ') this.windows.toggle(this.menus.quests);
      else if (e.code === 'KeyK') this.windows.toggle(this.menus.skills);
      else if (e.code === 'KeyL') this.windows.toggle(this.menus.friends);
      else if (e.code === 'KeyG') this.windows.toggle(this.menus.guild);
      else if (e.code === 'KeyP') this.windows.toggle(this.menus.party);
      else if (e.code === 'KeyO') this.windows.toggle(this.menus.options);
      else if (e.code === 'F11' && fullscreenSupported()) {
        e.preventDefault();
        this.toggleFullscreen();
      }
    });
  }

  // --- Loop -----------------------------------------------------------------

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.dpr = window.devicePixelRatio || 1;
    const auto = Math.max(1, Math.min(Math.floor(w / (17 * 48)), Math.floor(h / (11 * 48))));
    this.zoom = this.options.values.zoom || auto;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.scene.resize(w / this.zoom, h / this.zoom);
  }

  private update(): void {
    const input = this.input;
    if (this.message.active) {
      this.message.update(input);
    } else if (this.windows.hasOpen) {
      // Cancel closes the top window (going back one level); the menu key is not used here.
      input.consume('menu');
      this.windows.handleInput(input);
    } else if (input.consume('menu')) {
      input.consume('cancel');
      this.toggleMainMenu();
    }
    this.refreshFreeze();
    this.controller.update();
    input.endFrame();
    this.scene.update();
  }

  private render(): void {
    const ctx = this.ctx;
    const now = performance.now();
    const fractions = Array.from({ length: 8 }, (_, i) => this.slotCooldown(this.skills.hotbar[i], now));
    this.hud.setHotbarCooldowns(fractions);
    this.touch.setCooldowns(fractions);
    ctx.setTransform(this.dpr * this.zoom, 0, 0, this.dpr * this.zoom, Math.round(this.shakeOffset() * this.dpr * this.zoom), 0);
    ctx.imageSmoothingEnabled = false;
    this.scene.render(ctx);
    if (this.options.values.showNames) {
      this.drawName(this.scene.player, this.character.name, this.guildTag);
      for (const { info, character } of this.scene.remotes.values()) this.drawName(character, info.name, info.guild);
    }
    if (this.options.values.showBubbles) this.drawBubbles(now);
    this.hud.drawMinimap(this.scene);
    this.hud.setTarget(this.targetInfo());
  }

  /**
   * Selects a target from a combat action when none is chosen: the monster hit
   * by the player, or the monster attacking the player.
   */
  private autoTarget(actor: { kind: 'player' | 'monster'; id: number }, cells: { x: number; y: number }[]): void {
    const self = actor.kind === 'player' && actor.id === this.character.id;
    if (self) {
      const hit = [...this.scene.monsters.values()].find((m) => !m.dying && cells.some((c) => c.x === m.character.x && c.y === m.character.y));
      if (hit) this.target = { kind: 'monster', id: hit.view.id };
    } else if (actor.kind === 'monster' && !this.target && cells.some((c) => c.x === this.scene.player.x && c.y === this.scene.player.y)) {
      this.target = { kind: 'monster', id: actor.id };
    }
  }

  /** What the target frame shows (and forgets a target that is gone). */
  private targetInfo(): TargetInfo | null {
    const target = this.target;
    if (target?.kind === 'monster') {
      const m = this.scene.monsters.get(target.id);
      if (m && !m.dying) return { name: m.view.name, sub: '', hp: m.hp, maxHp: m.maxHp };
    } else if (target?.kind === 'player') {
      const r = this.scene.remotes.get(target.id);
      if (r) return { name: r.info.name, sub: r.info.guild ? `<${r.info.guild}>` : '' };
    }
    this.target = null;
    return null;
  }

  /** Chat bubbles above the characters who spoke on the map channel. */
  private drawBubbles(now: number): void {
    const ctx = this.ctx;
    for (const [id, bubble] of this.bubbles) {
      if (now > bubble.until) {
        this.bubbles.delete(id);
        continue;
      }
      const c = this.scene.combatant({ kind: 'player', id }, this.character.id);
      if (!c) continue;
      const T = this.scene.tileSize;
      const text = bubble.text.length > 60 ? `${bubble.text.slice(0, 57)}…` : bubble.text;
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      const w = Math.min(260, ctx.measureText(text).width + 14);
      const x = Math.round(c.realX * T + T / 2 - this.scene.cameraX - w / 2);
      const y = Math.round(c.realY * T - T * 0.95 - this.scene.cameraY - 24);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.strokeStyle = 'rgba(20, 30, 60, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 20, 6);
      ctx.moveTo(x + w / 2 - 5, y + 20);
      ctx.lineTo(x + w / 2, y + 26);
      ctx.lineTo(x + w / 2 + 5, y + 20);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1a2140';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + w / 2, y + 10, w - 10);
    }
  }

  private drawName(c: MapScene['player'], name: string, guild?: string): void {
    const ctx = this.ctx;
    const T = this.scene.tileSize;
    const x = Math.round(c.realX * T + T / 2 - this.scene.cameraX);
    const y = Math.round(c.realY * T + T + 10 - this.scene.cameraY);
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.strokeText(name, x, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, x, y);
    if (guild) {
      // The guild tag under the name.
      ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
      ctx.strokeText(`<${guild}>`, x, y + 13);
      ctx.fillStyle = '#9be38f';
      ctx.fillText(`<${guild}>`, x, y + 13);
    }
  }

  private loop(time: number): void {
    this.lastRaf = performance.now();
    this.frame(time);
    requestAnimationFrame((t2) => this.loop(t2));
  }

  /** Runs the pending fixed updates and draws one frame. */
  private frame(time: number): void {
    if (this.lastTime === 0) this.lastTime = time;
    // Clamp long pauses (tab in background) so the game does not fast-forward.
    this.accumulator += Math.min(250, time - this.lastTime);
    this.lastTime = time;
    while (this.accumulator >= FRAME_MS) {
      this.update();
      this.accumulator -= FRAME_MS;
    }
    this.render();
  }

  /** Direction helper for tests and debugging. */
  get playerDirection(): Direction {
    return this.scene.player.direction;
  }
}

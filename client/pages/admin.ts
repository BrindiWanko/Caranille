/**
 * @file Administration panel: dashboard (players online, server load,
 * active maps and instances, refreshed every 5 seconds), accounts (search,
 * roles, bans, mutes, kick, password reset, characters and their logs,
 * trades included), game tools (teleport, invisibility, give items and gold,
 * switches and variables, announcement), logs and database backups.
 *
 * Every action calls `/api/admin`, which checks the role again; buttons
 * reserved to administrators are only shown to them.
 */
import { t, tDynamic } from '../i18n.js';
import { el } from '../ui/dom.js';

const root = document.getElementById('admin-root')!;
const csrf = root.dataset.csrf ?? '';
const isAdmin = root.dataset.role === 'admin';

type Json = Record<string, unknown>;

/** Calls the API; throws with a translated message on error. */
async function api<T = Json>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new Error(tDynamic(String(data.error ?? 'error.http.server'), data.params as Record<string, string>));
  return data as T;
}

const status = el('div', { className: 'admin-status', attrs: { role: 'status' } });
function say(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle('error', error);
}
/** Runs an action and reports its result. */
async function act(run: () => Promise<unknown>, done = t('admin_panel.done')): Promise<void> {
  try {
    await run();
    say(done);
  } catch (err) {
    say((err as Error).message, true);
  }
}

const button = (label: string, onClick: () => void, className = 'button small') => el('button', { className, text: label, attrs: { type: 'button' }, on: { click: onClick } });
const input = (placeholder: string, type = 'text', value = '') => {
  const i = el('input', { attrs: { type, placeholder, 'aria-label': placeholder } });
  i.value = value;
  return i;
};
const num = (i: HTMLInputElement) => Math.trunc(Number(i.value));

/** A table of objects. */
function table(rows: Json[], columns?: string[]): HTMLElement {
  if (rows.length === 0) return el('p', { className: 'hint', text: t('admin_panel.empty') });
  const cols = columns ?? Object.keys(rows[0]!);
  return el('div', { className: 'admin-table-wrap' }, [
    el('table', { className: 'admin-table' }, [
      el('tr', {}, cols.map((c) => el('th', { text: tDynamic(`admin_panel.col.${c}`) }))),
      ...rows.map((r) => el('tr', {}, cols.map((c) => el('td', { text: r[c] === null || r[c] === undefined ? '' : String(r[c]) })))),
    ]),
  ]);
}

// --- Tabs ------------------------------------------------------------------------

type Tab = 'dashboard' | 'accounts' | 'tools' | 'logs' | 'backup';
const tabs: Tab[] = isAdmin ? ['dashboard', 'accounts', 'tools', 'logs', 'backup'] : ['dashboard', 'accounts', 'logs'];
const content = el('section', { className: 'window admin-content' });
let current: Tab = 'dashboard';
let refresh: number | undefined;
const nav = el('nav', { className: 'admin-tabs' });

function show(tab: Tab): void {
  current = tab;
  window.clearInterval(refresh);
  nav.replaceChildren(...tabs.map((x) => button(tDynamic(`admin_panel.tab.${x}`), () => show(x), `button${x === current ? ' primary' : ''}`)));
  say('');
  if (tab === 'dashboard') {
    void dashboard();
    refresh = window.setInterval(() => void dashboard(), 5000);
  } else if (tab === 'accounts') accounts();
  else if (tab === 'tools') tools();
  else if (tab === 'logs') logs();
  else backup();
}

// --- Dashboard ---------------------------------------------------------------------

async function dashboard(): Promise<void> {
  try {
    const d = await api<{ players: Json[]; maps: Json[]; instances: Json[]; server: Json }>('GET', '/dashboard');
    const s = d.server;
    const mb = (b: unknown) => `${Math.round(Number(b) / 1048576)} Mo`;
    content.replaceChildren(
      el('h2', { text: t('admin_panel.tab.dashboard') }),
      el('div', { className: 'admin-cards' }, [
        card(t('admin_panel.online'), String(d.players.length)),
        card(t('admin_panel.accounts'), String(s.accounts)),
        card(t('admin_panel.cpu'), `${s.cpu} %`),
        card(t('admin_panel.memory'), mb(s.rss)),
        card(t('admin_panel.lag'), `${s.lag} ms`),
        card(t('admin_panel.uptime'), `${Math.floor(Number(s.uptime) / 3600)} h ${Math.floor((Number(s.uptime) % 3600) / 60)} min`),
      ]),
      el('h3', { text: t('admin_panel.players') }),
      table(d.players, ['name', 'level', 'mapId', 'instance', 'x', 'y', 'invisible']),
      el('h3', { text: t('admin_panel.maps') }),
      table(d.maps),
      el('h3', { text: t('admin_panel.instances') }),
      table(d.instances),
    );
  } catch (err) {
    say((err as Error).message, true);
  }
}

function card(label: string, value: string): HTMLElement {
  return el('div', { className: 'admin-card' }, [el('span', { text: label }), el('strong', { text: value })]);
}

// --- Accounts ----------------------------------------------------------------------

function accounts(): void {
  const query = input(t('admin_panel.search'));
  const results = el('div');
  const detail = el('div', { className: 'admin-detail' });
  const search = async () => {
    try {
      const { accounts: list } = await api<{ accounts: Json[] }>('GET', `/accounts?q=${encodeURIComponent(query.value)}`);
      results.replaceChildren(
        ...list.map((a) =>
          el('button', { className: 'admin-account', attrs: { type: 'button' }, on: { click: () => void open(Number(a.id), detail) } }, [
            el('strong', { text: String(a.username) }),
            el('span', { text: ` ${a.email} — ${tDynamic(`auth.role.${a.role}`)}${a.bannedUntil ? ` — ${t('admin_panel.banned')}` : ''}${a.mutedUntil ? ` — ${t('admin_panel.muted')}` : ''}` }),
          ]),
        ),
      );
    } catch (err) {
      say((err as Error).message, true);
    }
  };
  query.addEventListener('keydown', (e) => e.key === 'Enter' && void search());
  content.replaceChildren(el('h2', { text: t('admin_panel.tab.accounts') }), el('div', { className: 'admin-row' }, [query, button(t('admin_panel.search'), () => void search())]), results, detail);
  void search();
}

async function open(id: number, host: HTMLElement): Promise<void> {
  const d = await api<{ account: Json; characters: Json[]; logs: Record<string, Json[]> }>('GET', `/accounts/${id}`);
  const a = d.account;
  const reload = () => void open(id, host);
  const minutes = input(t('admin_panel.minutes'), 'number', '60');
  const reason = input(t('admin_panel.reason'));
  const sanctions = el('div', { className: 'admin-row' }, [
    minutes,
    reason,
    button(t('admin_panel.ban'), () => void act(() => api('POST', `/accounts/${id}/ban`, { minutes: num(minutes), reason: reason.value })).then(reload)),
    ...(isAdmin ? [button(t('admin_panel.ban_forever'), () => window.confirm(t('admin_panel.confirm')) && void act(() => api('POST', `/accounts/${id}/ban`, { permanent: true, reason: reason.value })).then(reload), 'button small danger')] : []),
    button(t('admin_panel.unban'), () => void act(() => api('POST', `/accounts/${id}/unban`)).then(reload)),
    button(t('admin_panel.mute'), () => void act(() => api('POST', `/accounts/${id}/mute`, { minutes: num(minutes), reason: reason.value })).then(reload)),
    button(t('admin_panel.unmute'), () => void act(() => api('POST', `/accounts/${id}/unmute`)).then(reload)),
    button(t('admin_panel.kick'), () => void act(() => api('POST', `/accounts/${id}/kick`))),
  ]);
  const adminTools: HTMLElement[] = [];
  if (isAdmin) {
    const role = el('select', {}, ['player', 'moderator', 'admin'].map((r) => el('option', { text: tDynamic(`auth.role.${r}`), attrs: { value: r } })));
    role.value = String(a.role);
    adminTools.push(
      el('div', { className: 'admin-row' }, [
        role,
        button(t('admin_panel.set_role'), () => void act(() => api('POST', `/accounts/${id}/role`, { role: role.value })).then(reload)),
        button(t('admin_panel.reset_password'), () => {
          if (!window.confirm(t('admin_panel.confirm'))) return;
          void api<{ password: string }>('POST', `/accounts/${id}/reset-password`)
            .then((r) => say(t('admin_panel.new_password', { password: r.password })))
            .catch((err: Error) => say(err.message, true));
        }),
      ]),
    );
  }
  const characters = d.characters.map((c) =>
    el('div', { className: 'admin-row' }, [
      el('span', { text: `${c.name} (${t('hud.level', { level: Number(c.level) })}) — ${c.online ? t('friends.online') : t('friends.offline')} — ${c.gold}` }),
      button(t('admin_panel.reset_position'), () => void act(() => api('POST', `/characters/${c.id}/reset-position`))),
    ]),
  );
  host.replaceChildren(
    el('h3', { text: `${a.username} — ${tDynamic(`auth.role.${a.role}`)}` }),
    el('p', { className: 'hint', text: `${t('admin_panel.col.at')} ${a.createdAt} · ${t('admin_panel.last_login')} ${a.lastLogin ?? '—'}${a.bannedUntil ? ` · ${t('admin_panel.banned')} ${a.bannedUntil} (${a.banReason ?? ''})` : ''}${a.mutedUntil ? ` · ${t('admin_panel.muted')} ${a.mutedUntil}` : ''}` }),
    sanctions,
    ...adminTools,
    el('h4', { text: t('admin_panel.characters') }),
    ...characters,
    ...Object.entries(d.logs).map(([type, lines]) => el('details', { className: 'admin-log', attrs: type === 'trades' ? { open: '' } : {} }, [el('summary', { text: `${tDynamic(`admin_panel.log.${type}`)} (${lines.length})` }), table(lines)])),
  );
}

// --- Tools ------------------------------------------------------------------------

function tools(): void {
  const who = input(t('admin_panel.character_id'), 'number');
  const map = input(t('admin_panel.map_id'), 'number', '1');
  const x = input('X', 'number', '20');
  const y = input('Y', 'number', '17');
  const kind = el('select', {}, ['item', 'weapon', 'armor'].map((k) => el('option', { text: tDynamic(`db.option.${k}`), attrs: { value: k } })));
  const itemId = input(t('admin_panel.item_id'), 'number', '1');
  const qty = input(t('admin_panel.quantity'), 'number', '1');
  const gold = input(t('admin_panel.gold'), 'number', '0');
  const switchId = input(t('admin_panel.switch_id'), 'number', '1');
  const switchOn = el('select', {}, [el('option', { text: t('ev.on'), attrs: { value: '1' } }), el('option', { text: t('ev.off'), attrs: { value: '0' } })]);
  const variableId = input(t('admin_panel.variable_id'), 'number', '1');
  const variableValue = input(t('admin_panel.value'), 'number', '0');
  const announce = input(t('admin_panel.announce_text'));
  const target = () => num(who);
  content.replaceChildren(
    el('h2', { text: t('admin_panel.tab.tools') }),
    el('p', { className: 'hint', text: t('admin_panel.tools_help') }),
    el('fieldset', {}, [el('legend', { text: t('admin_panel.teleport') }), el('div', { className: 'admin-row' }, [
      who, map, x, y,
      button(t('admin_panel.teleport_player'), () => void act(() => api('POST', '/tools/teleport', { characterId: target(), mapId: num(map), x: num(x), y: num(y) }))),
      button(t('admin_panel.teleport_self'), () => void act(() => api('POST', '/tools/teleport', { characterId: 'self', mapId: num(map), x: num(x), y: num(y) }))),
      button(t('admin_panel.go_to_player'), () => void act(() => api('POST', '/tools/teleport', { characterId: 'self', toCharacterId: target() }))),
      button(t('admin_panel.summon_player'), () => void act(() => api('POST', '/tools/teleport', { characterId: target(), toCharacterId: 'self' }))),
    ])]),
    el('fieldset', {}, [el('legend', { text: t('admin_panel.invisibility') }), el('div', { className: 'admin-row' }, [
      button(t('admin_panel.invisible_on'), () => void act(() => api('POST', '/tools/invisible', { on: true }))),
      button(t('admin_panel.invisible_off'), () => void act(() => api('POST', '/tools/invisible', { on: false }))),
    ])]),
    el('fieldset', {}, [el('legend', { text: t('admin_panel.give') }), el('div', { className: 'admin-row' }, [
      kind, itemId, qty, gold,
      button(t('admin_panel.give'), () => void act(() => api('POST', '/tools/give', { characterId: target(), kind: kind.value, id: num(itemId), quantity: num(qty), gold: num(gold) }))),
    ])]),
    el('fieldset', {}, [el('legend', { text: t('admin_panel.progress') }), el('div', { className: 'admin-row' }, [
      switchId, switchOn,
      button(t('admin_panel.set_switch'), () => void act(() => api('POST', '/tools/progress', { characterId: target(), switchId: num(switchId), switchValue: switchOn.value === '1' }))),
      variableId, variableValue,
      button(t('admin_panel.set_variable'), () => void act(() => api('POST', '/tools/progress', { characterId: target(), variableId: num(variableId), variableValue: num(variableValue) }))),
    ])]),
    el('fieldset', {}, [el('legend', { text: t('admin_panel.announce') }), el('div', { className: 'admin-row' }, [
      announce,
      button(t('admin_panel.announce'), () => void act(() => api('POST', '/tools/announce', { text: announce.value }))),
    ])]),
  );
}

// --- Logs --------------------------------------------------------------------------

function logs(): void {
  const type = el('select', {}, ['connections', 'trades', 'sales', 'drops', 'reports', 'admin'].map((x) => el('option', { text: tDynamic(`admin_panel.log.${x}`), attrs: { value: x } })));
  const account = input(t('admin_panel.account_id'), 'number');
  const out = el('div');
  const load = () =>
    void api<{ lines: Json[] }>('GET', `/logs/${type.value}?account=${num(account) || 0}`)
      .then((r) => out.replaceChildren(table(r.lines)))
      .catch((err: Error) => say(err.message, true));
  type.addEventListener('change', load);
  content.replaceChildren(el('h2', { text: t('admin_panel.tab.logs') }), el('div', { className: 'admin-row' }, [type, account, button(t('admin_panel.show'), load)]), out);
  load();
}

// --- Backups -------------------------------------------------------------------------

function backup(): void {
  const file = el('input', { attrs: { type: 'file', accept: '.db,application/octet-stream', 'aria-label': t('admin_panel.restore_file') } });
  content.replaceChildren(
    el('h2', { text: t('admin_panel.tab.backup') }),
    el('p', { text: t('admin_panel.backup_help') }),
    el('a', { className: 'button primary', text: t('admin_panel.download_backup'), attrs: { href: '/api/admin/backup' } }),
    el('h3', { text: t('admin_panel.restore') }),
    el('p', { className: 'hint', text: t('admin_panel.restore_help') }),
    el('div', { className: 'admin-row' }, [
      file,
      button(t('admin_panel.restore'), () => {
        const f = file.files?.[0];
        if (!f || !window.confirm(t('admin_panel.confirm'))) return;
        void act(async () => {
          const res = await fetch('/api/admin/restore', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': csrf }, body: f });
          const data = (await res.json().catch(() => ({}))) as Json;
          if (!res.ok) throw new Error(tDynamic(String(data.error ?? 'error.http.server')));
        }, t('admin_panel.restore_scheduled'));
      }, 'button small danger'),
    ]),
    el('p', { className: 'hint', text: t('admin_panel.resources_help') }),
  );
}

root.replaceChildren(el('header', { className: 'window admin-header' }, [el('h1', { text: t('admin_panel.title') }), el('a', { className: 'button small', text: t('admin_panel.back_to_game'), attrs: { href: '/characters' } })]), nav, status, content);
show('dashboard');

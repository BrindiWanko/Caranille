/**
 * @file Move route editor: the list of route commands on the left (select,
 * delete, reorder), buttons adding commands on the right, and the route
 * options (repeat, skip blocked steps, wait for completion).
 */
import { RouteCmd, type MoveRoute } from '../../shared/events.js';
import { t, tDynamic } from '../i18n.js';
import { el } from '../ui/dom.js';
import { routeCommandText } from './command-specs.js';
import { checkbox, field, numberInput, openModal, readInt, select } from './dialogs.js';

type RouteRow = MoveRoute['list'][number];

/** Commands offered as buttons, in display order (the ones with parameters ask for them). */
const BUTTONS: number[] = [
  RouteCmd.MoveDown, RouteCmd.MoveLeft, RouteCmd.MoveRight, RouteCmd.MoveUp,
  RouteCmd.MoveRandom, RouteCmd.MoveToward, RouteCmd.MoveAway, RouteCmd.MoveForward, RouteCmd.MoveBackward,
  RouteCmd.TurnDown, RouteCmd.TurnLeft, RouteCmd.TurnRight, RouteCmd.TurnUp,
  RouteCmd.Turn90R, RouteCmd.Turn90L, RouteCmd.Turn180, RouteCmd.TurnRandom, RouteCmd.TurnToward, RouteCmd.TurnAway,
  RouteCmd.Wait, RouteCmd.Speed,
  RouteCmd.WalkAnimeOn, RouteCmd.WalkAnimeOff, RouteCmd.StepAnimeOn, RouteCmd.StepAnimeOff,
  RouteCmd.DirFixOn, RouteCmd.DirFixOff, RouteCmd.ThroughOn, RouteCmd.ThroughOff,
  RouteCmd.Image, RouteCmd.PlaySe,
];

/**
 * Opens the route editor.
 * @param host - Editor root.
 * @param route - Route to edit (not modified).
 * @param resources - Character sheets and sounds for the image / sound commands.
 * @param showWait - Offers the "wait for completion" option (event commands only).
 * @returns The edited route, or `null` when cancelled.
 */
export function editRoute(host: HTMLElement, route: MoveRoute, resources: { characters: string[]; se: string[] }, showWait = true): Promise<MoveRoute | null> {
  const rows: RouteRow[] = structuredClone(route.list.filter((r) => r.code !== RouteCmd.End));
  let selected = rows.length;
  const list = el('ol', { className: 'route-list', attrs: { tabindex: '0' } });
  const repeat = checkbox(route.repeat);
  const skippable = checkbox(route.skippable);
  const wait = checkbox(route.wait);

  const render = () => {
    list.replaceChildren(
      ...rows.map((r, i) => el('li', { className: i === selected ? 'selected' : '', text: routeCommandText(r), on: { click: () => ((selected = i), render()) } })),
      el('li', { className: `route-end${selected === rows.length ? ' selected' : ''}`, text: '◇', on: { click: () => ((selected = rows.length), render()) } }),
    );
  };

  /** Asks for the parameter of a command, then inserts it before the selection. */
  const add = (code: number) => {
    const insert = (params: unknown[] = []) => {
      rows.splice(selected, 0, { code, parameters: params });
      selected++;
      render();
    };
    if (code === RouteCmd.Wait) {
      const frames = numberInput(30, 1, 3600);
      openModal(host, tDynamic(`ev.route.${code}`), el('div', { className: 'form-grid' }, [field(t('ev.field.frames'), frames)]), [
        { label: t('common.cancel') },
        { label: t('editor.apply'), primary: true, onClick: () => insert([readInt(frames, 1, 3600)]) },
      ]);
    } else if (code === RouteCmd.Speed) {
      const speed = select([1, 2, 3, 4, 5, 6].map((s): [string, string] => [String(s), tDynamic(`ev.speed.${s}`)]), '3');
      openModal(host, tDynamic(`ev.route.${code}`), el('div', { className: 'form-grid' }, [field(t('ev.field.speed'), speed)]), [
        { label: t('common.cancel') },
        { label: t('editor.apply'), primary: true, onClick: () => insert([Number(speed.value)]) },
      ]);
    } else if (code === RouteCmd.Image) {
      const sheet = select([['', t('editor.none')], ...resources.characters.map((n): [string, string] => [n, n])], resources.characters[0] ?? '');
      const index = numberInput(0, 0, 7);
      openModal(host, tDynamic(`ev.route.${code}`), el('div', { className: 'form-grid' }, [field(t('editor.character_sheet'), sheet), field(t('editor.character_index'), index)]), [
        { label: t('common.cancel') },
        { label: t('editor.apply'), primary: true, onClick: () => insert([sheet.value, readInt(index, 0, 7)]) },
      ]);
    } else if (code === RouteCmd.PlaySe) {
      const name = select(resources.se.map((n): [string, string] => [n, n]), resources.se[0] ?? '');
      openModal(host, tDynamic(`ev.route.${code}`), el('div', { className: 'form-grid' }, [field(t('ev.field.sound'), name), resources.se.length ? null : el('p', { className: 'hint', text: t('ev.no_se') })]), [
        { label: t('common.cancel') },
        { label: t('editor.apply'), primary: true, onClick: () => insert([{ name: name.value, volume: 90, pitch: 100, pan: 0 }]) },
      ]);
    } else {
      insert();
    }
  };

  const remove = () => {
    if (selected >= rows.length) return;
    rows.splice(selected, 1);
    render();
  };
  const move = (delta: number) => {
    const to = selected + delta;
    if (selected >= rows.length || to < 0 || to >= rows.length) return;
    [rows[selected], rows[to]] = [rows[to]!, rows[selected]!];
    selected = to;
    render();
  };
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Delete') remove();
    else if (e.key === 'ArrowUp') selected = Math.max(0, selected - 1);
    else if (e.key === 'ArrowDown') selected = Math.min(rows.length, selected + 1);
    else return;
    e.preventDefault();
    render();
  });
  render();

  const buttons = el(
    'div',
    { className: 'route-buttons' },
    BUTTONS.map((code) => el('button', { className: 'button small', text: tDynamic(`ev.route.${code}`), attrs: { type: 'button' }, on: { click: () => add(code) } })),
  );
  const tools = el('div', { className: 'inline-row' }, [
    el('button', { className: 'button small', text: '↑', attrs: { type: 'button', title: t('ev.move_up') }, on: { click: () => move(-1) } }),
    el('button', { className: 'button small', text: '↓', attrs: { type: 'button', title: t('ev.move_down') }, on: { click: () => move(1) } }),
    el('button', { className: 'button small danger', text: t('editor.delete'), attrs: { type: 'button' }, on: { click: remove } }),
  ]);
  const options = el('div', { className: 'form-grid' }, [field(t('ev.route.repeat'), repeat), field(t('ev.route.skippable'), skippable), showWait ? field(t('ev.route.wait'), wait) : null]);

  return new Promise((resolve) => {
    let done = false;
    const close = openModal(host, t('ev.edit_route'), el('div', { className: 'route-editor' }, [el('div', { className: 'route-left' }, [list, tools, options]), buttons]), [
      { label: t('common.cancel'), onClick: () => ((done = true), resolve(null)) },
      {
        label: t('editor.apply'),
        primary: true,
        onClick: () => {
          done = true;
          resolve({ list: [...structuredClone(rows), { code: RouteCmd.End }], repeat: repeat.checked, skippable: skippable.checked, wait: showWait ? wait.checked : false });
        },
      },
    ]);
    // Closing with Escape counts as cancelling.
    const observer = new MutationObserver(() => {
      if (!done && !host.contains(list)) {
        observer.disconnect();
        resolve(null);
      }
    });
    observer.observe(host, { childList: true });
    void close;
  });
}

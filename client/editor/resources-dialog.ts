/**
 * @file Resource manager and project import of the editor.
 *
 * - Resource manager: drop images or sounds (or pick files); each file is
 *   uploaded, sorted into its folder (automatically, or into the chosen one)
 *   and the detected sheet format is shown. Uploaded resources can be deleted;
 *   generated ones cannot.
 * - Project import: a zipped project folder is sent to the server, which
 *   imports tilesets, maps and resources and answers with a report.
 */
import { RESOURCE_KINDS } from '../../shared/resource-formats.js';
import { t, tDynamic } from '../i18n.js';
import { el } from '../ui/dom.js';
import { EditorApiError, type EditorApi } from './api.js';
import { field, openModal, select } from './dialogs.js';

interface ManifestEntry {
  id: string;
  kind: string;
  name: string;
  url: string;
  format: string;
  width: number | null;
  height: number | null;
  origin: string;
}

/** Translated label of a detected format (sheet slot suffixes shown as A1…E). */
export function formatLabel(format: string): string {
  const sheet = /-(a[1-5]|[b-e])$/.exec(format)?.[1];
  const base = sheet ? format.slice(0, -sheet.length - 1) : format;
  return `${tDynamic(`dev_assets.format.${base}`)}${sheet ? ` ${sheet.toUpperCase()}` : ''}`;
}

/**
 * Opens the resource manager.
 * @param host - Editor root.
 * @param api - Editor API.
 * @param onChanged - Called after uploads or deletions (to refresh pickers).
 */
export function openResourceManager(host: HTMLElement, api: EditorApi, onChanged: () => void): void {
  const kind = select([['auto', t('editor.resources.auto_kind')], ...RESOURCE_KINDS.map((k): [string, string] => [k, k])], 'auto');
  const results = el('ul', { className: 'upload-results' });
  const list = el('div', { className: 'resource-list' });
  const input = el('input', { attrs: { type: 'file', multiple: '', accept: 'image/png,image/jpeg,image/webp,image/svg+xml,audio/*' } });

  const refresh = async () => {
    const { resources } = (await fetch('/api/resources', { credentials: 'same-origin' }).then((r) => r.json())) as { resources: ManifestEntry[] };
    const byKind = new Map<string, ManifestEntry[]>();
    for (const r of resources) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
    list.replaceChildren(
      ...[...byKind].map(([k, items]) =>
        el('details', { className: 'resource-group' }, [
          el('summary', { text: `${k} (${items.length})` }),
          el(
            'ul',
            {},
            items.map((r) =>
              el('li', {}, [
                r.url.match(/\.(png|jpe?g|webp|svg)$/i) ? el('img', { attrs: { src: r.url, alt: '', loading: 'lazy' } }) : el('span', { text: '♪' }),
                el('span', { className: 'resource-name', text: r.name }),
                el('span', { className: 'resource-meta', text: `${r.width ?? '?'}×${r.height ?? '?'} · ${formatLabel(r.format)}` }),
                r.origin === 'generated'
                  ? el('span', { className: 'resource-meta', text: t('editor.resources.generated') })
                  : el('button', {
                      className: 'button small danger',
                      text: t('editor.delete'),
                      attrs: { type: 'button' },
                      on: {
                        click: async () => {
                          await api.delete(`/resources/${encodeURIComponent(r.kind)}/${encodeURIComponent(r.name)}`);
                          onChanged();
                          await refresh();
                        },
                      },
                    }),
              ]),
            ),
          ),
        ]),
      ),
    );
  };

  const upload = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const row = el('li', { text: `${file.name}…` });
      results.append(row);
      try {
        const name = file.name.replace(/\.[a-z0-9]+$/i, '');
        const { resource } = await api.upload<{ resource: ManifestEntry | null }>(`/resources?kind=${encodeURIComponent(kind.value)}&name=${encodeURIComponent(name)}`, file);
        row.textContent = resource ? t('editor.resources.uploaded', { name: resource.name, kind: resource.kind, format: formatLabel(resource.format) }) : file.name;
        row.className = 'ok';
      } catch (err) {
        row.textContent = `${file.name} : ${err instanceof EditorApiError ? tDynamic(err.key, err.params) : String(err)}`;
        row.className = 'error';
      }
    }
    onChanged();
    await refresh();
  };

  input.addEventListener('change', () => input.files && void upload(input.files));
  const drop = el('div', { className: 'drop-zone', text: t('editor.resources.drop_here') }, []);
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer?.files.length) void upload(e.dataTransfer.files);
  });
  drop.addEventListener('click', () => input.click());

  openModal(host, t('editor.resources.title'), el('div', { className: 'resource-manager' }, [
    field(t('editor.resources.folder'), kind),
    drop,
    input,
    el('p', { className: 'hint', text: t('editor.resources.help') }),
    results,
    list,
  ]), [{ label: t('ui.close') }]);
  void refresh();
}

/** Import report returned by the server. */
interface ImportReport {
  tilesets: number;
  maps: number;
  images: number;
  sounds: number;
  warnings: { key: string; params?: Record<string, string | number> }[];
}

/**
 * Opens the project import dialog.
 * @param onDone - Called after a successful import (to reload the map tree).
 */
export function openImportDialog(host: HTMLElement, api: EditorApi, onDone: () => void): void {
  const input = el('input', { attrs: { type: 'file', accept: '.zip,application/zip' } });
  const output = el('div', { className: 'import-report' });
  openModal(host, t('editor.import.title'), el('div', {}, [
    el('p', { className: 'hint', text: t('editor.import.help') }),
    input,
    output,
  ]), [
    { label: t('ui.close') },
    {
      label: t('editor.import.start'),
      primary: true,
      onClick: async () => {
        const file = input.files?.[0];
        if (!file) throw new EditorApiError('error.import.no_file');
        output.replaceChildren(el('p', { text: t('common.loading') }));
        const { report } = await api.upload<{ report: ImportReport }>('/import', file);
        output.replaceChildren(
          el('p', { className: 'ok', text: t('editor.import.summary', { maps: report.maps, tilesets: report.tilesets, images: report.images, sounds: report.sounds }) }),
          report.warnings.length
            ? el('ul', { className: 'import-warnings' }, report.warnings.map((w) => el('li', { text: tDynamic(w.key, w.params) })))
            : el('p', { text: t('editor.import.no_warning') }),
        );
        onDone();
        return false; // keep the dialog open to read the report
      },
    },
  ]);
}

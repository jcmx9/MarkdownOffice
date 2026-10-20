import { posix, win32 } from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/types'

export interface MenuDeps {
  platform: NodeJS.Platform
  isDev: boolean
  recent: readonly string[]
  command(c: MenuCommand): void
  openRecent(path: string): void
  clearRecent(): void
  /** Settings.spellcheck: the tick of the Rechtschreibprüfung checkbox. */
  spellcheck: boolean
  /** Clock for the held-shortcut guard (tests); defaults to Date.now. */
  now?: () => number
  /** Auto-repeat guard fed by the window's before-input-event; a fresh one otherwise. */
  presentKey?: PresentKeyGuard
}

/**
 * Fallback only: accelerator clicks closer than this belong to one held shortcut, used when no
 * matching key input was observed (see PresentKeyGuard). OS auto-repeat fires every ~30–50 ms
 * once running and its initial delay is at least 250 ms by default on macOS, Windows and
 * Linux, so two deliberate presses more than 250 ms apart both toggle.
 */
const KEY_REPEAT_MS = 250
/** A matching keyDown is used for the accelerator click that follows it within this time. */
const INPUT_FRESH_MS = 500

/** The fields of Electron's before-input-event `Input` the guard reads. */
export interface KeyInput {
  type: string
  key: string
  /** Physical key; 'KeyP' also on layouts where P types another letter (e.g. Cyrillic). */
  code: string
  isAutoRepeat: boolean
  shift: boolean
  control: boolean
  alt: boolean
  meta: boolean
}

/**
 * Decides whether an accelerator click of toggle-present comes from an OS auto-repeat of a
 * held Cmd/Ctrl+Shift+P: a held shortcut must toggle Present exactly once.
 *
 * Electron's menu click carries no repeat flag, but the window's webContents emits
 * 'before-input-event' with `isAutoRepeat` before menu shortcuts are dispatched (Electron
 * docs: preventDefault there "will prevent ... the menu shortcuts"; this also covers macOS key
 * equivalents, which Chromium offers to the page before the main menu). A native probe was not
 * possible on the dev machine (synthetic OS keystrokes need accessibility rights), so the
 * timing window stays as a fallback for clicks without a matching, fresh keyDown (e.g. focus
 * outside the page). Manual check on macOS and Windows: PR checklist.
 */
export class PresentKeyGuard {
  /** The latest matching keyDown not yet consumed by a click. */
  private seen: { repeat: boolean; at: number } | null = null
  private lastClick = Number.NEGATIVE_INFINITY

  constructor(
    private readonly mac: boolean,
    private readonly now: () => number = Date.now,
  ) {}

  /** Feed every before-input-event. A keyUp needs no handling: a new press is not a repeat. */
  onInput(i: KeyInput): void {
    const isP = i.key.toLowerCase() === 'p' || i.code === 'KeyP'
    if (i.type !== 'keyDown' || !isP || !i.shift || i.alt) return
    if (this.mac ? !i.meta : !i.control) return
    this.seen = { repeat: i.isAutoRepeat, at: this.now() }
  }

  /** For an accelerator-triggered toggle-present click: true = ignore it (auto-repeat). */
  ignoreClick(): boolean {
    const t = this.now()
    const seen = this.seen
    this.seen = null
    const previous = this.lastClick
    this.lastClick = t
    if (seen && t - seen.at < INPUT_FRESH_MS) return seen.repeat
    return t - previous < KEY_REPEAT_MS
  }
}

/** Electron passes this as the click handler's third argument. */
interface ClickEvent {
  triggeredByAccelerator?: boolean
}

export function buildMenuTemplate(d: MenuDeps): MenuItemConstructorOptions[] {
  const mac = d.platform === 'darwin'
  const presentKey = d.presentKey ?? new PresentKeyGuard(mac, d.now)
  const heldRepeat = (id: MenuCommand, event: ClickEvent | undefined): boolean =>
    id === 'toggle-present' && event?.triggeredByAccelerator === true && presentKey.ignoreClick()
  const item = (
    id: MenuCommand,
    label: string,
    accelerator?: string,
  ): MenuItemConstructorOptions => ({
    id,
    label,
    accelerator,
    click: (_item, _win, event: ClickEvent | undefined) => {
      if (!heldRepeat(id, event)) d.command(id)
    },
  })
  const sep: MenuItemConstructorOptions = { type: 'separator' }

  const settings = item('settings', 'Einstellungen …', 'CmdOrCtrl+,')

  // macOS: the standard app menu (Electron's appMenu role) with the settings item added.
  const appMenu: MenuItemConstructorOptions = {
    role: 'appMenu',
    submenu: [
      { role: 'about' },
      sep,
      settings,
      sep,
      { role: 'services' },
      sep,
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      sep,
      { role: 'quit' },
    ],
  }

  const labels = recentLabels(d.recent, d.platform)
  const recent: MenuItemConstructorOptions[] = d.recent.length
    ? [
        ...d.recent.map(
          (p, i): MenuItemConstructorOptions => ({
            label: labels[i] ?? p,
            // Hover text exists only in macOS menus (Electron: darwin-only `toolTip`).
            toolTip: p,
            click: () => d.openRecent(p),
          }),
        ),
        sep,
        { label: 'Liste leeren', click: () => d.clearRecent() },
      ]
    : [{ label: 'Keine Einträge', enabled: false }]

  const file: MenuItemConstructorOptions = {
    label: 'Datei',
    submenu: [
      item('new', 'Neu', 'CmdOrCtrl+N'),
      item('new-from-template', 'Neu aus Vorlage …', 'CmdOrCtrl+Shift+N'),
      // No accelerator: a rare action, and the renderer refuses it (toast) for a note without
      // `template:` or whose set ships no example profile.
      item('create-profile', 'Profil anlegen …'),
      item('open', 'Öffnen …', 'CmdOrCtrl+O'),
      { label: 'Zuletzt geöffnet', submenu: recent },
      sep,
      item('rename', 'Umbenennen …', 'CmdOrCtrl+Shift+R'),
      item('close-tab', 'Tab schließen', 'CmdOrCtrl+W'),
      sep,
      item('export', 'PDF exportieren', 'CmdOrCtrl+E'),
      ...(mac
        ? []
        : [sep, settings, sep, { role: 'quit', label: 'Beenden' } as MenuItemConstructorOptions]),
    ],
  }

  const edit: MenuItemConstructorOptions = {
    label: 'Bearbeiten',
    submenu: [
      item('undo', 'Widerrufen', 'CmdOrCtrl+Z'),
      item('redo', 'Wiederholen', 'CmdOrCtrl+Shift+Z'),
      sep,
      { role: 'cut', label: 'Ausschneiden' },
      { role: 'copy', label: 'Kopieren' },
      { role: 'paste', label: 'Einfügen' },
      item('select-all', 'Alles auswählen', 'CmdOrCtrl+A'),
      sep,
      {
        ...item('toggle-spellcheck', 'Rechtschreibprüfung'),
        type: 'checkbox',
        checked: d.spellcheck,
      },
    ],
  }

  const insert: MenuItemConstructorOptions = {
    label: 'Einfügen',
    submenu: [
      item('insert-header', 'YAML-Header …'),
      item('insert-pagebreak', 'Seitenumbruch', 'CmdOrCtrl+Enter'),
    ],
  }

  const foldKey = mac ? 'Cmd+Alt+' : 'Ctrl+Shift+'
  const view: MenuItemConstructorOptions = {
    label: 'Ansicht',
    submenu: [
      item('toggle-present', 'Präsentieren ein/aus', 'CmdOrCtrl+Shift+P'),
      sep,
      item('toggle-view', 'Code-Ansicht ein/aus', 'CmdOrCtrl+Shift+M'),
      item('toggle-header', 'YAML-Header ein/aus', 'CmdOrCtrl+Shift+H'),
      item('toggle-outline', 'Gliederung ein/aus', 'CmdOrCtrl+Shift+O'),
      sep,
      item('fold', 'Abschnitt einklappen', `${foldKey}[`),
      item('unfold', 'Abschnitt ausklappen', `${foldKey}]`),
      // Not Ctrl+Alt on Windows/Linux: that is AltGr, which types `[` / `]` on German layouts.
      item('fold-all', 'Alle einklappen', mac ? 'Ctrl+Alt+[' : 'Alt+0'),
      item('unfold-all', 'Alle ausklappen', mac ? 'Ctrl+Alt+]' : 'Alt+Shift+0'),
      sep,
      item('zoom-in', 'Vergrößern', 'CmdOrCtrl+Plus'),
      item('zoom-out', 'Verkleinern', 'CmdOrCtrl+-'),
      item('zoom-reset', 'Originalgröße', 'CmdOrCtrl+0'),
      ...(d.isDev
        ? [
            sep,
            { role: 'reload' } as MenuItemConstructorOptions,
            { role: 'toggleDevTools' } as MenuItemConstructorOptions,
          ]
        : []),
    ],
  }

  const window: MenuItemConstructorOptions = {
    label: 'Fenster',
    submenu: [
      item('next-tab', 'Nächster Tab', 'Ctrl+Tab'),
      item('prev-tab', 'Vorheriger Tab', 'Ctrl+Shift+Tab'),
      ...(mac
        ? [sep, { role: 'minimize', label: 'Im Dock ablegen' } as MenuItemConstructorOptions]
        : []),
    ],
  }

  // Windows/Linux have no app menu: the About panel (with the AGPL notices, see index.ts)
  // gets its own Hilfe menu there, as AGPL §5 d) asks every interactive UI to show them.
  const help: MenuItemConstructorOptions = {
    label: 'Hilfe',
    submenu: [{ role: 'about', label: 'Über Markdown Office' }],
  }

  return [...(mac ? [appMenu] : []), file, edit, insert, view, window, ...(mac ? [] : [help])]
}

/**
 * Right-click menu of a note (tab or status line file name). The shortcuts are shown for
 * reference only; the application menu owns them.
 */
export function noteMenuTemplate(command: (c: MenuCommand) => void): MenuItemConstructorOptions[] {
  const item = (
    id: MenuCommand,
    label: string,
    accelerator: string,
  ): MenuItemConstructorOptions => ({
    id,
    label,
    accelerator,
    registerAccelerator: false,
    click: () => command(id),
  })
  return [
    item('rename', 'Umbenennen …', 'CmdOrCtrl+Shift+R'),
    item('export', 'PDF exportieren', 'CmdOrCtrl+E'),
    { type: 'separator' },
    item('close-tab', 'Tab schließen', 'CmdOrCtrl+W'),
  ]
}

/**
 * Menu labels for the recent list: the file name only, because full paths make the submenu
 * unreadable; the full path is the hover text (macOS). Windows and Linux menus have no hover,
 * so names that occur more than once get their folder appended („Termin.md — Kunden“), and the
 * whole folder path when even the folder names are the same. `platform` picks the path rules,
 * so the labels are the same whatever OS the tests run on.
 */
export function recentLabels(paths: readonly string[], platform: NodeJS.Platform): string[] {
  const p = platform === 'win32' ? win32 : posix
  // Windows and macOS file systems usually ignore case, so „termin.md“ and „Termin.md“ collide.
  const key = (s: string) => (platform === 'linux' ? s : s.toLowerCase())
  const count = (xs: readonly string[]) => {
    const m = new Map<string, number>()
    for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1)
    return m
  }
  const names = paths.map((x) => p.basename(x))
  const nameCount = count(names)
  const folders = paths.map((x) => p.basename(p.dirname(x)))
  const folderCount = count(names.map((n, i) => `${n}/${folders[i]}`))
  return paths.map((x, i) => {
    const name = names[i] ?? x
    if ((nameCount.get(key(name)) ?? 0) < 2) return name
    const both = `${name}/${folders[i]}`
    const folder = (folderCount.get(key(both)) ?? 0) < 2 ? folders[i] : p.dirname(x)
    return `${name} — ${folder}`
  })
}

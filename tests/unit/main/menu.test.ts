import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  buildMenuTemplate,
  type MenuDeps,
  noteMenuTemplate,
  PresentKeyGuard,
} from '../../../src/main/menu'

const deps = (over: Partial<MenuDeps> = {}): MenuDeps => ({
  platform: 'darwin',
  isDev: false,
  recent: [],
  command: vi.fn(),
  openRecent: vi.fn(),
  clearRecent: vi.fn(),
  ...over,
})

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flatten(i.submenu) : [])])
}
const byId = (items: MenuItemConstructorOptions[], id: string) =>
  flatten(items).find((i) => i.id === id)
const click = (item: MenuItemConstructorOptions | undefined) => {
  if (!item) throw new Error('menu item not found')
  ;(item.click as unknown as () => void)()
}

describe('buildMenuTemplate', () => {
  it.each([
    ['new', 'CmdOrCtrl+N'],
    ['open', 'CmdOrCtrl+O'],
    ['rename', 'CmdOrCtrl+Shift+R'],
    ['close-tab', 'CmdOrCtrl+W'],
    ['export', 'CmdOrCtrl+E'],
    ['undo', 'CmdOrCtrl+Z'],
    ['redo', 'CmdOrCtrl+Shift+Z'],
    ['select-all', 'CmdOrCtrl+A'],
    ['insert-pagebreak', 'CmdOrCtrl+Enter'],
    ['next-tab', 'Ctrl+Tab'],
    ['prev-tab', 'Ctrl+Shift+Tab'],
    ['toggle-present', 'CmdOrCtrl+Shift+P'],
    ['toggle-view', 'CmdOrCtrl+Shift+M'],
    ['toggle-header', 'CmdOrCtrl+Shift+H'],
    ['toggle-outline', 'CmdOrCtrl+Shift+O'],
    ['fold', 'Cmd+Alt+['],
    ['unfold', 'Cmd+Alt+]'],
    ['fold-all', 'Ctrl+Alt+['],
    ['unfold-all', 'Ctrl+Alt+]'],
    ['zoom-in', 'CmdOrCtrl+Plus'],
    ['zoom-out', 'CmdOrCtrl+-'],
    ['zoom-reset', 'CmdOrCtrl+0'],
  ])('%s has accelerator %s and sends its command', (id, accelerator) => {
    const d = deps()
    const item = byId(buildMenuTemplate(d), id)
    expect(item?.accelerator).toBe(accelerator)
    click(item)
    expect(d.command).toHaveBeenCalledWith(id)
  })

  it('ignores toggle-present key repeats from a held shortcut', () => {
    let now = 1000
    const d = deps({ now: () => now })
    const item = byId(buildMenuTemplate(d), 'toggle-present')
    if (!item) throw new Error('menu item not found')
    const key = () =>
      (item.click as unknown as (a: unknown, b: unknown, e: unknown) => void)(null, null, {
        triggeredByAccelerator: true,
      })
    key()
    for (let i = 0; i < 20; i++) {
      now += 40 // OS key repeat while the shortcut is held
      key()
    }
    expect(d.command).toHaveBeenCalledTimes(1)
    now += 1000 // released, pressed again later
    key()
    expect(d.command).toHaveBeenCalledTimes(2)
    // Mouse clicks on the menu item are never debounced.
    click(item)
    expect(d.command).toHaveBeenCalledTimes(3)
  })

  it('two deliberate presses 300 ms apart both toggle Present', () => {
    let now = 1000
    const d = deps({ now: () => now })
    const item = byId(buildMenuTemplate(d), 'toggle-present')
    if (!item) throw new Error('menu item not found')
    const key = () =>
      (item.click as unknown as (a: unknown, b: unknown, e: unknown) => void)(null, null, {
        triggeredByAccelerator: true,
      })
    key()
    now += 300
    key()
    expect(d.command).toHaveBeenCalledTimes(2)
  })

  it('has an app menu on macOS and a quit item elsewhere', () => {
    expect(buildMenuTemplate(deps())[0]?.role).toBe('appMenu')
    const winItems = flatten(buildMenuTemplate(deps({ platform: 'win32' })))
    expect(winItems.some((i) => i.role === 'appMenu')).toBe(false)
    expect(winItems.some((i) => i.role === 'quit')).toBe(true)
  })

  it('lists recent files and can clear them', () => {
    const d = deps({ recent: ['/n/a.md', '/n/b.md'] })
    const items = flatten(buildMenuTemplate(d))
    click(items.find((i) => i.label === '/n/b.md'))
    expect(d.openRecent).toHaveBeenCalledWith('/n/b.md')
    click(items.find((i) => i.label === 'Liste leeren'))
    expect(d.clearRecent).toHaveBeenCalled()
  })

  it('shows a disabled placeholder without recent files', () => {
    const item = flatten(buildMenuTemplate(deps())).find((i) => i.label === 'Keine Einträge')
    expect(item?.enabled).toBe(false)
  })

  it('offers dev tools only in development', () => {
    const has = (isDev: boolean) =>
      flatten(buildMenuTemplate(deps({ isDev }))).some((i) => i.role === 'toggleDevTools')
    expect(has(true)).toBe(true)
    expect(has(false)).toBe(false)
  })

  it('uses Ctrl+Shift+[ / ] and Alt+0 / Alt+Shift+0 for folding on Windows and Linux', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const items = flatten(buildMenuTemplate(deps({ platform })))
      expect(items.find((i) => i.id === 'fold')?.accelerator).toBe('Ctrl+Shift+[')
      expect(items.find((i) => i.id === 'unfold')?.accelerator).toBe('Ctrl+Shift+]')
      // Ctrl+Alt is AltGr there: it must stay free for typing [ and ].
      expect(items.find((i) => i.id === 'fold-all')?.accelerator).toBe('Alt+0')
      expect(items.find((i) => i.id === 'unfold-all')?.accelerator).toBe('Alt+Shift+0')
      expect(items.some((i) => String(i.accelerator ?? '').startsWith('Ctrl+Alt+'))).toBe(false)
    }
  })

  it('labels the outline toggle in German', () => {
    expect(byId(buildMenuTemplate(deps()), 'toggle-outline')?.label).toBe('Gliederung ein/aus')
  })

  it('puts the view items under "Ansicht" in production too', () => {
    const view = buildMenuTemplate(deps()).find((m) => m.label === 'Ansicht')
    const ids = ((view?.submenu ?? []) as { id?: string }[]).map((i) => i.id).filter(Boolean)
    expect(ids).toEqual([
      'toggle-present',
      'toggle-view',
      'toggle-header',
      'toggle-outline',
      'fold',
      'unfold',
      'fold-all',
      'unfold-all',
      'zoom-in',
      'zoom-out',
      'zoom-reset',
    ])
  })
})

describe('PresentKeyGuard', () => {
  const input = (over: Partial<Parameters<PresentKeyGuard['onInput']>[0]> = {}) => ({
    type: 'keyDown',
    key: 'P',
    code: 'KeyP',
    isAutoRepeat: false,
    shift: true,
    control: false,
    alt: false,
    meta: true,
    ...over,
  })

  /** One OS key event: before-input-event, then (for keyDown) the accelerator click. */
  function setup(mac = true) {
    let now = 1000
    const d = deps({ platform: mac ? 'darwin' : 'win32' })
    const guard = new PresentKeyGuard(mac, () => now)
    const item = byId(buildMenuTemplate({ ...d, presentKey: guard }), 'toggle-present')
    if (!item) throw new Error('menu item not found')
    const accel = () =>
      (item.click as unknown as (a: unknown, b: unknown, e: unknown) => void)(null, null, {
        triggeredByAccelerator: true,
      })
    const keyDown = (repeat: boolean, over = {}) => {
      guard.onInput(input({ isAutoRepeat: repeat, ...over }))
      accel()
    }
    const keyUp = () => guard.onInput(input({ type: 'keyUp' }))
    const wait = (ms: number) => {
      now += ms
    }
    return { d, guard, keyDown, keyUp, wait, accel }
  }

  it('a held shortcut toggles exactly once, whatever the repeat timing', () => {
    const s = setup()
    s.keyDown(false)
    s.wait(600) // initial repeat delay longer than the fallback window
    for (let i = 0; i < 20; i++) {
      s.keyDown(true)
      s.wait(40)
    }
    expect(s.d.command).toHaveBeenCalledTimes(1)
  })

  it('a fresh press after keyUp toggles again', () => {
    const s = setup()
    s.keyDown(false)
    s.wait(500)
    s.keyDown(true)
    s.keyUp()
    s.wait(1000)
    s.keyDown(false)
    expect(s.d.command).toHaveBeenCalledTimes(2)
  })

  it('a deliberate double press (keyUp in between) toggles twice, even within 250 ms', () => {
    const s = setup()
    s.keyDown(false)
    s.wait(60)
    s.keyUp()
    s.wait(60)
    s.keyDown(false)
    expect(s.d.command).toHaveBeenCalledTimes(2)
  })

  it('uses Ctrl (not Meta) as the modifier off macOS', () => {
    const s = setup(false)
    s.keyDown(false, { meta: false, control: true })
    s.wait(600)
    s.keyDown(true, { meta: false, control: true })
    expect(s.d.command).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys and falls back to the 250 ms window without matching input', () => {
    const s = setup()
    // Not the shortcut (Alt held, other key): no input info for the accelerator clicks.
    s.keyDown(true, { alt: true })
    s.wait(1000)
    s.keyDown(true, { key: 'o', code: 'KeyO' })
    expect(s.d.command).toHaveBeenCalledTimes(2)
    s.wait(40)
    s.accel() // no input observed, 40 ms after the last press: fallback treats it as repeat
    expect(s.d.command).toHaveBeenCalledTimes(2)
    s.wait(300)
    s.accel()
    expect(s.d.command).toHaveBeenCalledTimes(3)
  })

  it('matches the physical P key on non-Latin layouts (key is not p)', () => {
    const s = setup(false)
    const cyrillic = { key: 'З', code: 'KeyP', meta: false, control: true }
    s.keyDown(false, cyrillic)
    s.wait(600) // past the fallback window: only the repeat flag can tell
    s.keyDown(true, cyrillic)
    expect(s.d.command).toHaveBeenCalledTimes(1)
  })

  it('input seen long before a click is stale and not used', () => {
    const s = setup()
    s.keyDown(false)
    s.wait(1000)
    // A repeat keyDown whose click never came (e.g. swallowed), then a click much later.
    s.guard.onInput(input({ isAutoRepeat: true }))
    s.wait(5000)
    s.accel()
    expect(s.d.command).toHaveBeenCalledTimes(2)
  })
})

describe('settings item', () => {
  it('sits in the macOS app menu with Cmd+,', () => {
    const d = deps()
    const template = buildMenuTemplate(d)
    const appMenu = template[0]
    const items = Array.isArray(appMenu?.submenu) ? appMenu.submenu : []
    const settings = items.find((i) => i.id === 'settings')
    expect(settings?.label).toBe('Einstellungen …')
    expect(settings?.accelerator).toBe('CmdOrCtrl+,')
    expect(items.some((i) => i.role === 'quit')).toBe(true)
    click(settings)
    expect(d.command).toHaveBeenCalledWith('settings')
    const file = template.find((m) => m.label === 'Datei')
    const fileItems = Array.isArray(file?.submenu) ? file.submenu : []
    expect(fileItems.some((i) => i.id === 'settings')).toBe(false)
  })

  it.each(['win32', 'linux'] as const)('sits in the File menu on %s with Ctrl+,', (platform) => {
    const d = deps({ platform })
    const file = buildMenuTemplate(d).find((m) => m.label === 'Datei')
    const items = Array.isArray(file?.submenu) ? file.submenu : []
    const settings = items.find((i) => i.id === 'settings')
    expect(settings?.label).toBe('Einstellungen …')
    expect(settings?.accelerator).toBe('CmdOrCtrl+,')
    click(settings)
    expect(d.command).toHaveBeenCalledWith('settings')
  })
})

describe('noteMenuTemplate', () => {
  it('offers rename, export and close; shortcuts only shown, not registered twice', () => {
    const command = vi.fn()
    const items = noteMenuTemplate(command)
    expect(items.map((i) => i.label ?? i.type)).toEqual([
      'Umbenennen …',
      'PDF exportieren',
      'separator',
      'Tab schließen',
    ])
    for (const i of items.filter((x) => x.type !== 'separator')) {
      expect(i.registerAccelerator).toBe(false)
      ;(i.click as () => void)()
    }
    expect(command.mock.calls.map((c) => c[0])).toEqual(['rename', 'export', 'close-tab'])
  })
})

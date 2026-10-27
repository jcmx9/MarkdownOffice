// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  droppedFields,
  isAbsolutePath,
  openSettings,
  parseFactor,
  pipelineLine,
  type SettingsDialogDeps,
  StatusTimeout,
  withTimeout,
} from '../../../src/renderer/ui/settings'
import type { Settings, SettingsStatus } from '../../../src/shared/types'

const settings: Settings = {
  defaultFolder: '/Users/u/Documents/Markdown Office',
  snippetFolder: '/Users/u/Documents/Markdown Office/Snippets',
  presentFontFactor: 1.6,
  headerDefault: 'yaml',
  spellcheck: true,
  dictionaryAutoUpdate: true,
  appUpdateCheck: true,
  outlineDepth: 2,
}

const status: SettingsStatus = { version: '26.10.0', typst: '0.15.0' }

const deps = (over: Partial<SettingsDialogDeps> = {}): SettingsDialogDeps => ({
  settings,
  status: Promise.resolve(status),
  choose: vi.fn(async () => null),
  openTemplatesFolder: vi.fn(async () => null),
  platform: 'win32',
  checkDictionaries: vi.fn(async () => ({ kind: 'current' as const })),
  words: vi.fn(async () => []),
  removeWord: vi.fn(async () => true),
  defaultAppStatus: vi.fn(async () => ({ state: 'other' as const, platform: 'win32' })),
  makeDefaultApp: vi.fn(async () => ({ ok: true, message: 'erledigt' })),
  ...over,
})

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.querySelector<T>(`[data-testid=${id}]`)
  if (!el) throw new Error(`missing ${id}`)
  return el
}
const input = (id: string) => $<HTMLInputElement>(id)
const press = (target: HTMLElement, key: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
const flush = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('settings dialog', () => {
  it('shows the current values and the status', async () => {
    void openSettings(deps())
    expect(document.querySelector('dialog.prompt h2')?.textContent).toBe('Einstellungen')
    expect(input('settings-default-folder').value).toBe(settings.defaultFolder)
    expect(input('settings-snippet-folder').value).toBe(settings.snippetFolder)
    expect(input('settings-factor').value).toBe('1.6')
    expect(input('settings-header-yaml').checked).toBe(true)
    expect(input('settings-header-titleblock').checked).toBe(false)
    const text = document.querySelector('dialog')?.textContent ?? ''
    for (const label of [
      'Standardordner für neue Notizen',
      'Snippet-Ordner',
      'Schriftfaktor im Präsentationsmodus',
      'YAML-Header in der Vorschau',
      'als YAML',
      'als Titelblock',
      'Wählen …',
      'Abbrechen',
      'Speichern',
    ])
      expect(text).toContain(label)
    await flush()
    expect($('settings-status-pipeline').textContent).toBe(
      'Pipeline: Markdown Office 26.10.0, Typst 0.15.0',
    )
    expect(document.querySelectorAll('dialog input[type=text]')).toHaveLength(2)
  })

  it('Save sends only the changed values', async () => {
    const done = openSettings(deps())
    input('settings-factor').value = '2.2'
    input('settings-header-titleblock').checked = true
    input('settings-snippet-folder').value = '/Volumes/Daten/Snippets'
    $('settings-save').click()
    expect(await done).toEqual({
      presentFontFactor: 2.2,
      headerDefault: 'titleblock',
      snippetFolder: '/Volumes/Daten/Snippets',
    })
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('Enter saves, also from a radio button', async () => {
    const done = openSettings(deps())
    input('settings-header-titleblock').checked = true
    press(input('settings-header-titleblock'), 'Enter')
    expect(await done).toEqual({ headerDefault: 'titleblock' })
  })

  it('Esc and Abbrechen cancel without a patch', async () => {
    const first = openSettings(deps())
    input('settings-factor').value = '2'
    press(input('settings-factor'), 'Escape')
    expect(await first).toBeNull()
    expect(document.querySelector('dialog')).toBeNull()
    const second = openSettings(deps())
    $('settings-cancel').click()
    expect(await second).toBeNull()
  })

  it.each(['0.9', '3.1', 'abc', ''])('refuses the factor %j and stays open', async (value) => {
    const done = vi.fn()
    void openSettings(deps()).then(done)
    input('settings-factor').value = value
    $('settings-save').click()
    await flush()
    expect(done).not.toHaveBeenCalled()
    expect($('settings-error').textContent).toBe(
      'Schriftfaktor: bitte eine Zahl von 1.0 bis 3.0 angeben.',
    )
    expect(document.querySelector('dialog')).not.toBeNull()
  })

  it('refuses relative or empty folders', async () => {
    const done = vi.fn()
    void openSettings(deps()).then(done)
    input('settings-snippet-folder').value = 'snippets'
    $('settings-save').click()
    await flush()
    expect(done).not.toHaveBeenCalled()
    expect($('settings-error').textContent).toBe(
      'Snippet-Ordner: bitte einen absoluten Pfad angeben.',
    )
  })

  it('Wählen … fills the field with the picked path; cancel keeps it', async () => {
    const choose = vi
      .fn<SettingsDialogDeps['choose']>()
      .mockResolvedValueOnce('/Volumes/Daten/Notizen')
      .mockResolvedValueOnce(null)
    void openSettings(deps({ choose }))
    $('settings-choose-default-folder').click()
    await flush()
    expect(choose).toHaveBeenLastCalledWith('folder', settings.defaultFolder)
    expect(input('settings-default-folder').value).toBe('/Volumes/Daten/Notizen')
    $('settings-choose-snippet-folder').click()
    await flush()
    expect(input('settings-snippet-folder').value).toBe(settings.snippetFolder)
  })

  it('shows when the status cannot be read', async () => {
    void openSettings(deps({ status: Promise.reject(new Error('x')) }))
    await flush()
    expect($('settings-status-pipeline').textContent).toBe('Status nicht verfügbar')
  })

  it('says so when the status does not arrive in time', async () => {
    void openSettings(deps({ status: Promise.reject(new StatusTimeout(10_000)) }))
    await flush()
    expect($('settings-status-pipeline').textContent).toBe(
      'Status nicht verfügbar (keine Antwort nach 10 s)',
    )
  })
})

describe('updates section', () => {
  it('shows the app update switch and returns a change', async () => {
    const done = openSettings(deps())
    expect(input('set-app-update').checked).toBe(true)
    input('set-app-update').checked = false
    $('settings-save').click()
    expect(await done).toEqual({ appUpdateCheck: false })
  })
})

describe('spelling section', () => {
  it('shows both switches with the current values and returns changes', async () => {
    const done = openSettings(deps())
    expect(input('set-spellcheck').checked).toBe(true)
    expect(input('set-dict-auto').checked).toBe(true)
    input('set-spellcheck').checked = false
    input('set-dict-auto').checked = false
    $('settings-save').click()
    expect(await done).toEqual({ spellcheck: false, dictionaryAutoUpdate: false })
  })

  it('on macOS shows the system hint and no update controls', async () => {
    void openSettings(deps({ platform: 'darwin' }))
    expect($('set-mac-spell-hint').textContent).toBe(
      'Sprachen und Wörterbücher verwaltet macOS: Systemeinstellungen → Tastatur → Texteingabe',
    )
    for (const id of ['set-dict-auto', 'set-dict-check', 'set-dict-status'])
      expect(document.querySelector(`[data-testid=${id}]`)).toBeNull()
  })

  it.each([
    [{ kind: 'current' }, 'Wörterbücher aktuell'],
    [
      { kind: 'updated', version: '26.10.2', files: [], pending: false },
      'Aktualisiert auf 26.10.2',
    ],
    [
      { kind: 'updated', version: '26.10.2', files: ['de-DE-3-0.bdic'], pending: true },
      'Aktualisiert auf 26.10.2 – aktiv nach Neustart',
    ],
    [{ kind: 'failed', reason: 'offline' }, 'Prüfung fehlgeschlagen: offline'],
  ] as const)('Jetzt prüfen shows %j as %s', async (result, text) => {
    const checkDictionaries = vi.fn(async () => result as never)
    void openSettings(deps({ checkDictionaries }))
    $('set-dict-check').click()
    await flush()
    expect(checkDictionaries).toHaveBeenCalledOnce()
    expect($('set-dict-status').textContent).toBe(text)
  })

  it('Vorlagen-Ordner öffnen asks main to open the folder and keeps the dialog open', async () => {
    const openTemplatesFolder = vi.fn(async () => null)
    void openSettings(deps({ openTemplatesFolder }))
    const button = $('settings-open-templates')
    expect(button.textContent).toBe('Vorlagen-Ordner öffnen')
    button.click()
    await flush()
    expect(openTemplatesFolder).toHaveBeenCalledOnce()
    expect($('settings-templates-status').textContent).toBe('')
    expect(document.querySelector('dialog')?.open).toBe(true)
  })

  it.each([
    [async () => 'Vorlagen-Ordner konnte nicht geöffnet werden: kaputt', 'kaputt'],
    [
      async () => {
        throw new Error('weg')
      },
      'Vorlagen-Ordner nicht geöffnet: weg',
    ],
  ])('Vorlagen-Ordner öffnen shows a failure next to the button (%#)', async (open, text) => {
    void openSettings(deps({ openTemplatesFolder: open }))
    $('settings-open-templates').click()
    await flush()
    expect($('settings-templates-status').textContent).toContain(text)
  })

  it('lists own words; Entfernen removes the word and its row', async () => {
    const removeWord = vi.fn(async () => true)
    void openSettings(deps({ words: async () => ['Foo', 'Bar'], removeWord }))
    await flush()
    expect($('set-words').textContent).toContain('Foo')
    $('set-word-remove-0').click()
    await flush()
    expect(removeWord).toHaveBeenCalledWith('Foo')
    expect($('set-words').textContent).not.toContain('Foo')
    expect($('set-words').textContent).toContain('Bar')
  })

  it('keeps the row when the removal fails', async () => {
    void openSettings(deps({ words: async () => ['Foo'], removeWord: async () => false }))
    await flush()
    $('set-word-remove-0').click()
    await flush()
    expect($('set-words').textContent).toContain('Foo')
  })
})

describe('withTimeout', () => {
  afterEach(() => vi.useRealTimers())

  it('passes a timely result through', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7)
  })

  it('rejects with StatusTimeout when the promise hangs', async () => {
    vi.useFakeTimers()
    const result = withTimeout(new Promise<never>(() => undefined), 10_000)
    const check = expect(result).rejects.toBeInstanceOf(StatusTimeout)
    await vi.advanceTimersByTimeAsync(10_000)
    await check
  })
})

describe('droppedFields', () => {
  it('names every patched value that main did not store', () => {
    const saved = { ...settings, presentFontFactor: 2 }
    expect(
      droppedFields(
        { snippetFolder: 'relativ', presentFontFactor: 2, defaultFolder: 'C:\\x' },
        saved,
      ),
    ).toEqual([
      'Standardordner für neue Notizen: kein gültiger absoluter Pfad',
      'Snippet-Ordner: kein gültiger absoluter Pfad',
    ])
  })

  it('is empty when everything was stored', () => {
    expect(
      droppedFields({ headerDefault: 'titleblock' }, { ...settings, headerDefault: 'titleblock' }),
    ).toEqual([])
  })
})

describe('Standardprogramm', () => {
  it('offers the button while another program opens .md files', async () => {
    void openSettings(deps())
    await flush()
    expect($('set-default-app-status').textContent).toBe(
      'Markdown-Dateien (.md) öffnet ein anderes Programm.',
    )
    expect($('set-default-app').hidden).toBe(false)
  })

  it('hides the button when Markdown Office is the default', async () => {
    void openSettings(
      deps({
        defaultAppStatus: vi.fn(async () => ({ state: 'default' as const, platform: 'darwin' })),
      }),
    )
    await flush()
    expect($('set-default-app-status').textContent).toBe(
      'Markdown-Dateien (.md) öffnen mit Markdown Office.',
    )
    expect($('set-default-app').hidden).toBe(true)
  })

  it('says it cannot tell when the query fails, and still offers the button', async () => {
    void openSettings(deps({ defaultAppStatus: vi.fn(async () => Promise.reject(new Error('x'))) }))
    await flush()
    expect($('set-default-app-status').textContent).toMatch(/^Nicht feststellbar/)
    expect($('set-default-app').hidden).toBe(false)
  })

  it('runs the command, shows its message and asks again', async () => {
    const status = vi
      .fn()
      .mockResolvedValueOnce({ state: 'other', platform: 'darwin' })
      .mockResolvedValueOnce({ state: 'default', platform: 'darwin' })
    const make = vi.fn(async () => ({
      ok: true,
      message: 'Markdown-Dateien öffnen jetzt mit Markdown Office.',
    }))
    void openSettings(deps({ defaultAppStatus: status, makeDefaultApp: make }))
    await flush()
    $('set-default-app').click()
    await flush()
    await flush()
    expect(make).toHaveBeenCalledOnce()
    expect($('set-default-app-result').textContent).toBe(
      'Markdown-Dateien öffnen jetzt mit Markdown Office.',
    )
    expect(status).toHaveBeenCalledTimes(2)
    expect($('set-default-app').hidden).toBe(true)
  })
})

describe('pipelineLine', () => {
  it('names the app version and the Typst version, or that Typst is missing', () => {
    expect(pipelineLine(status)).toBe('Pipeline: Markdown Office 26.10.0, Typst 0.15.0')
    expect(pipelineLine({ version: '26.10.0-dev.1', typst: null })).toBe(
      'Pipeline: Markdown Office 26.10.0-dev.1, Typst nicht gefunden',
    )
  })
})

describe('parseFactor', () => {
  it.each([
    ['1', 1],
    ['3', 3],
    ['1.6', 1.6],
    ['2,5', 2.5],
    [' 2 ', 2],
    ['0.99', null],
    ['3.01', null],
    ['', null],
    ['x', null],
    ['Infinity', null],
  ])('%j → %s', (text, value) => {
    expect(parseFactor(text)).toBe(value)
  })
})

describe('isAbsolutePath', () => {
  it.each([
    ['/Users/u', true],
    ['C:\\Users\\u', true],
    ['C:/Users/u', true],
    ['\\\\server\\share', true],
    ['relativ', false],
    ['./x', false],
    ['C:relativ', false],
    ['', false],
  ])('%j → %s', (p, abs) => {
    expect(isAbsolutePath(p)).toBe(abs)
  })
})

describe('outline depth', () => {
  it('offers 1–6 levels, shows the current one and returns a change', async () => {
    const done = openSettings(deps())
    const select = $<HTMLSelectElement>('settings-outline-depth')
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ['1', 'nur H1'],
      ['2', 'H1–H2'],
      ['3', 'H1–H3'],
      ['4', 'H1–H4'],
      ['5', 'H1–H5'],
      ['6', 'H1–H6'],
    ])
    expect(select.value).toBe('2')
    select.value = '4'
    $('settings-save').click()
    expect(await done).toEqual({ outlineDepth: 4 })
  })
  it('an unchanged depth is not part of the patch', async () => {
    const done = openSettings(deps())
    $('settings-save').click()
    expect(await done).toEqual({})
  })
})

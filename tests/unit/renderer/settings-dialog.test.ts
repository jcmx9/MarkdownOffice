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
}

const status: SettingsStatus = { version: '26.10.0', typst: '0.15.0' }

const deps = (over: Partial<SettingsDialogDeps> = {}): SettingsDialogDeps => ({
  settings,
  status: Promise.resolve(status),
  choose: vi.fn(async () => null),
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

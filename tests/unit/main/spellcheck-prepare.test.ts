import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEAD_DOWNLOAD_URL,
  prepareSpellcheck,
  SpellcheckController,
} from '../../../src/main/spellcheck/controller'
import { defaultSettings } from '../../../src/main/store'
import type { UpdateResult } from '../../../src/shared/types'

/** Records every spellchecker call; `bundledSeen` notes whether the files were in place. */
const h = vi.hoisted(() => ({
  calls: [] as string[],
  dictFile: '',
  bundledSeen: null as boolean | null,
  download: 'installed' as 'installed' | 'pending' | 'failed',
  update: { kind: 'current' } as UpdateResult,
}))

function fakeSession() {
  return {
    setSpellCheckerDictionaryDownloadURL: (u: string) => h.calls.push(`url ${u}`),
    setSpellCheckerLanguages: (l: string[]) => h.calls.push(`languages ${l.join(',')}`),
    setSpellCheckerEnabled: (on: boolean) => h.calls.push(`enabled ${on}`),
    on: (event: string) => h.calls.push(`on ${event}`),
  }
}

vi.mock('electron', async () => {
  const { existsSync: exists } = await import('node:fs')
  const s = fakeSession()
  return {
    app: { getPreferredSystemLanguages: () => ['de-DE'] },
    Menu: {},
    net: {},
    session: {
      // Creating the default session starts Chromium's dictionary load: record what was there.
      get defaultSession() {
        h.bundledSeen = exists(h.dictFile)
        h.calls.push('defaultSession')
        return s
      },
    },
  }
})

vi.mock('../../../src/main/spellcheck/updates', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/spellcheck/updates')>()),
  downloadDictionary: async () => h.download,
  checkForUpdates: async () => h.update,
}))

const dir = () => mkdtempSync(join(tmpdir(), 'mdo-prep-'))

beforeEach(() => {
  h.calls.length = 0
  h.bundledSeen = null
})

describe('prepareSpellcheck (app start)', () => {
  it('installs the bundled files before it touches the default session', async () => {
    const bundled = dir()
    writeFileSync(join(bundled, 'de-DE-3-0.bdic'), 'DE')
    const userData = dir()
    h.dictFile = join(userData, 'Dictionaries', 'de-DE-3-0.bdic')
    await prepareSpellcheck({
      userData,
      bundledDir: bundled,
      platform: 'linux',
      settings: { ...defaultSettings('/docs'), spellcheck: false },
    })
    expect(h.bundledSeen).toBe(true)
    const at = h.calls.indexOf('defaultSession')
    expect(h.calls.slice(at)).toEqual([
      'defaultSession',
      `url ${DEAD_DOWNLOAD_URL}`,
      'on spellcheck-dictionary-download-begin',
      'on spellcheck-dictionary-download-failure',
      // System language de-DE is installed; the switch (off) is applied after the list,
      // because Electron's setSpellCheckerLanguages switches checking on.
      'languages de-DE',
      'enabled false',
    ])
  })

  it('does nothing on macOS (system spellchecker)', async () => {
    await prepareSpellcheck({
      userData: dir(),
      bundledDir: null,
      platform: 'darwin',
      settings: defaultSettings('/docs'),
    })
    expect(h.calls).toEqual([])
  })
})

function controller(userData: string) {
  const session = fakeSession()
  const win = { webContents: { session, on: () => undefined } } as unknown as BrowserWindow
  return new SpellcheckController(win, {
    userData,
    bundledDir: null,
    platform: 'win32',
    settings: () => ({ ...defaultSettings('/docs'), spellcheck: false }),
  })
}

describe('SpellcheckController activation', () => {
  it('setLanguage re-applies the switch after the language list', async () => {
    const userData = dir()
    const c = controller(userData)
    await c.setLanguage('de')
    expect(h.calls).toEqual(['languages ', 'enabled false'])
  })

  it('a downloaded missing language is activated at once', async () => {
    const userData = dir()
    const c = controller(userData)
    await c.setLanguage('fr')
    h.calls.length = 0
    // The (mocked) download placed the file; the reload must now apply it.
    mkdirSync(join(userData, 'Dictionaries'), { recursive: true })
    writeFileSync(join(userData, 'Dictionaries', 'fr-FR-3-0.bdic'), 'FR')
    h.download = 'installed'
    expect(await c.downloadDictionary('fr-FR')).toBe(true)
    expect(h.calls).toEqual(['languages fr-FR', 'enabled false'])
  })

  it('a staged download or update is not reloaded during the session', async () => {
    const c = controller(dir())
    h.download = 'pending'
    expect(await c.downloadDictionary('fr-FR')).toBe(true)
    h.update = { kind: 'updated', version: '26.11.0', files: ['de-DE-3-0.bdic'], pending: true }
    expect(await c.checkNow()).toEqual(h.update)
    expect(h.calls).toEqual([])
  })
})

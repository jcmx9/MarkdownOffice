import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { describe, expect, it } from 'vitest'
import { DEAD_DOWNLOAD_URL, SpellcheckController } from '../../../src/main/spellcheck/controller'
import { defaultSettings } from '../../../src/main/store'
import type { Settings } from '../../../src/shared/types'

/** A session stand-in that records the spellchecker calls in order. */
function fakeWindow() {
  const calls: string[] = []
  const session = {
    setSpellCheckerDictionaryDownloadURL: (url: string) => calls.push(`url ${url}`),
    setSpellCheckerEnabled: (on: boolean) => calls.push(`enabled ${on}`),
    on: (event: string) => calls.push(`on ${event}`),
  }
  return { calls, win: { webContents: { session } } as unknown as BrowserWindow }
}

const dir = () => mkdtempSync(join(tmpdir(), 'mdo-spell-'))

describe('SpellcheckController', () => {
  it('on Windows/Linux blocks the download and installs the bundled dictionaries', async () => {
    const { calls, win } = fakeWindow()
    const bundled = dir()
    writeFileSync(join(bundled, 'de-DE-3-0.bdic'), 'DE')
    const userData = dir()
    const c = new SpellcheckController(win, {
      userData,
      bundledDir: bundled,
      platform: 'win32',
      settings: () => defaultSettings('/docs'),
    })
    await c.start()
    expect(calls[0]).toBe(`url ${DEAD_DOWNLOAD_URL}`)
    expect(calls).toContain('enabled true')
    expect(readFileSync(join(userData, 'Dictionaries', 'de-DE-3-0.bdic'), 'utf8')).toBe('DE')
  })

  it('on macOS only switches the system checker', async () => {
    const { calls, win } = fakeWindow()
    const settings: Settings = { ...defaultSettings('/docs'), spellcheck: false }
    const c = new SpellcheckController(win, {
      userData: dir(),
      bundledDir: null,
      platform: 'darwin',
      settings: () => settings,
    })
    await c.start()
    expect(calls).toEqual(['enabled false'])
  })

  it('applies a changed switch', () => {
    const { calls, win } = fakeWindow()
    const c = new SpellcheckController(win, {
      userData: dir(),
      bundledDir: null,
      platform: 'linux',
      settings: () => defaultSettings('/docs'),
    })
    c.applySettings({ ...defaultSettings('/docs'), spellcheck: false })
    expect(calls).toEqual(['enabled false'])
  })
})

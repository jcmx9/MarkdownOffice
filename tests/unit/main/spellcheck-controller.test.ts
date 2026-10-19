import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { describe, expect, it } from 'vitest'
import { DEAD_DOWNLOAD_URL, SpellcheckController } from '../../../src/main/spellcheck/controller'
import { defaultSettings } from '../../../src/main/store'
import { Ch } from '../../../src/shared/ipc'
import type { Settings } from '../../../src/shared/types'

type Listener = (...args: unknown[]) => void

/** A session stand-in that records the spellchecker calls in order. */
function fakeSession() {
  const calls: string[] = []
  const listeners = new Map<string, Listener[]>()
  const session = {
    setSpellCheckerDictionaryDownloadURL: (url: string) => calls.push(`url ${url}`),
    setSpellCheckerEnabled: (on: boolean) => calls.push(`enabled ${on}`),
    on: (event: string, fn: Listener) => {
      calls.push(`on ${event}`)
      listeners.set(event, [...(listeners.get(event) ?? []), fn])
    },
    off: (event: string, fn: Listener) =>
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((l) => l !== fn),
      ),
    emit: (event: string, ...args: unknown[]) => {
      for (const l of listeners.get(event) ?? []) l({}, ...args)
    },
  }
  return { calls, session }
}

/** A window stand-in on `session`; `sent` records the channels sent to its renderer. */
function windowOn(session: ReturnType<typeof fakeSession>['session']) {
  const sent: string[] = []
  const closed: (() => void)[] = []
  const win = {
    isDestroyed: () => false,
    once: (event: string, fn: () => void) => {
      if (event === 'closed') closed.push(fn)
    },
    webContents: { session, on: () => undefined, send: (ch: string) => sent.push(ch) },
  } as unknown as BrowserWindow
  const close = () => {
    for (const fn of closed.splice(0)) fn()
  }
  return { win, sent, close }
}

function fakeWindow() {
  const { calls, session } = fakeSession()
  return { calls, session, ...windowOn(session) }
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

  it('activates a staged update before the window loads', async () => {
    const { win } = fakeWindow()
    const userData = dir()
    const dicts = join(userData, 'Dictionaries')
    mkdirSync(dicts)
    writeFileSync(join(dicts, 'de-DE-3-0.bdic'), 'OLD')
    writeFileSync(join(dicts, 'de-DE-3-0.bdic.pending'), 'NEW')
    const sum = createHash('sha256').update('NEW').digest('hex')
    writeFileSync(
      join(dicts, 'mdo-dictionaries.json'),
      JSON.stringify({ version: '26.11.0', files: { 'de-DE-3-0.bdic': sum } }),
    )
    const c = new SpellcheckController(win, {
      userData,
      bundledDir: null,
      platform: 'win32',
      settings: () => ({ ...defaultSettings('/docs'), dictionaryAutoUpdate: false }),
    })
    await c.start()
    expect(readFileSync(join(dicts, 'de-DE-3-0.bdic'), 'utf8')).toBe('NEW')
    expect(existsSync(join(dicts, 'de-DE-3-0.bdic.pending'))).toBe(false)
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

  it('applies the switch even when installing the bundled dictionaries fails', async () => {
    const { calls, win } = fakeWindow()
    // A file where the Dictionaries folder should go: mkdir fails like a permission error.
    const userData = dir()
    writeFileSync(join(userData, 'Dictionaries'), 'not a folder')
    const bundled = dir()
    writeFileSync(join(bundled, 'de-DE-3-0.bdic'), 'DE')
    const c = new SpellcheckController(win, {
      userData,
      bundledDir: bundled,
      platform: 'linux',
      settings: () => ({ ...defaultSettings('/docs'), spellcheck: false }),
    })
    await expect(c.start()).resolves.toBeUndefined()
    expect(calls).toContain('enabled false')
  })

  it('registers the download-failure warning once per session', async () => {
    const { calls, session } = fakeWindow()
    // Two windows on the shared default session (e.g. macOS reopen on a Linux-like setup).
    for (let i = 0; i < 2; i++) {
      const { win } = windowOn(session)
      const c = new SpellcheckController(win, {
        userData: dir(),
        bundledDir: null,
        platform: 'win32',
        settings: () => defaultSettings('/docs'),
      })
      await c.start()
    }
    expect(calls.filter((c) => c === 'on spellcheck-dictionary-download-failure')).toHaveLength(1)
    expect(calls.filter((c) => c === 'on spellcheck-dictionary-download-begin')).toHaveLength(1)
    // The dead URL is set again per window (cheap, and never skipped).
    expect(calls.filter((c) => c.startsWith('url '))).toHaveLength(2)
  })

  // Chromium checks the shown text once and never again when the dictionaries change: a
  // lang: de note opened on an English system kept English (or no) markers (Windows CI).
  it('asks the renderer to check again whenever a dictionary has loaded, until closed', async () => {
    const { session, win, sent, close } = fakeWindow()
    const c = new SpellcheckController(win, {
      userData: dir(),
      bundledDir: null,
      platform: 'win32',
      settings: () => ({ ...defaultSettings('/docs'), dictionaryAutoUpdate: false }),
    })
    await c.start()
    expect(sent).toEqual([])
    session.emit('spellcheck-dictionary-initialized', 'de-DE')
    expect(sent).toEqual([Ch.spellRecheck])
    close()
    session.emit('spellcheck-dictionary-initialized', 'en-US')
    expect(sent).toEqual([Ch.spellRecheck])
  })
})

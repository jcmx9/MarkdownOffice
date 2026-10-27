import { describe, expect, it, vi } from 'vitest'
import {
  BUNDLE_ID,
  type DefaultAppEnv,
  defaultAppStatus,
  isOwnProgId,
  MAC_CONTENT_TYPE,
  makeDefaultApp,
  type Run,
  WIN_SETTINGS_URL,
  windowsRegistration,
} from '../../../src/main/default-app'

const EXE = 'C:\\Users\\u\\AppData\\Local\\Markdown Office\\Markdown Office.exe'

function env(over: Partial<DefaultAppEnv> = {}): DefaultAppEnv {
  return {
    platform: 'darwin',
    isPackaged: true,
    execPath: EXE,
    env: { SystemRoot: 'C:\\Windows' },
    home: '/home/u',
    run: vi.fn<Run>(async () => ''),
    openExternal: vi.fn(async () => undefined),
    exists: () => true,
    ...over,
  }
}

describe('defaultAppStatus', () => {
  it('is unknown in a dev build and asks nothing', async () => {
    const run = vi.fn<Run>(async () => BUNDLE_ID)
    expect(await defaultAppStatus(env({ isPackaged: false, run }))).toEqual({
      state: 'unknown',
      platform: 'darwin',
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('macOS: asks Launch Services for the Markdown type, with the type as an argument', async () => {
    const run = vi.fn<Run>(async () => `${BUNDLE_ID}\n`)
    expect((await defaultAppStatus(env({ run }))).state).toBe('default')
    const [file, args] = run.mock.calls[0] as unknown as [string, string[]]
    expect(file).toBe('/usr/bin/osascript')
    expect(args.slice(0, 2)).toEqual(['-l', 'JavaScript'])
    expect(args.at(-1)).toBe(MAC_CONTENT_TYPE)
    expect(
      (await defaultAppStatus(env({ run: vi.fn<Run>(async () => 'com.apple.TextEdit') }))).state,
    ).toBe('other')
  })

  it('Windows: reads the user choice of .md', async () => {
    const out =
      '\r\nHKEY_CURRENT_USER\\...\\UserChoice\r\n    ProgId    REG_SZ    MarkdownOffice.md\r\n\r\n'
    const run = vi.fn<Run>(async () => out)
    expect((await defaultAppStatus(env({ platform: 'win32', run }))).state).toBe('default')
    expect(run.mock.calls[0]?.[0]).toBe('C:\\Windows\\System32\\reg.exe')
    const none = vi.fn<Run>(async () => Promise.reject(new Error('not found')))
    expect((await defaultAppStatus(env({ platform: 'win32', run: none }))).state).toBe('other')
  })

  it('Linux: asks xdg-mime', async () => {
    const run = vi.fn<Run>(async () => 'markdown-office.desktop\n')
    expect((await defaultAppStatus(env({ platform: 'linux', run }))).state).toBe('default')
    expect(run).toHaveBeenCalledWith('xdg-mime', ['query', 'default', 'text/markdown'])
  })

  it('is unknown when the tool fails', async () => {
    const run = vi.fn<Run>(async () => Promise.reject(new Error('no xdg-mime')))
    expect((await defaultAppStatus(env({ platform: 'linux', run }))).state).toBe('unknown')
  })
})

describe('isOwnProgId', () => {
  it.each([
    ['MarkdownOffice.md', true],
    ['Applications\\Markdown Office.exe', true],
    ['VSCode.md', false],
    ['', false],
  ])('%j → %s', (id, own) => {
    expect(isOwnProgId(id)).toBe(own)
  })
})

describe('makeDefaultApp', () => {
  it('refuses in a dev build', async () => {
    const run = vi.fn<Run>(async () => '0')
    expect((await makeDefaultApp(env({ isPackaged: false, run }))).ok).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('macOS: sets the handler and reports an OSStatus error', async () => {
    const run = vi.fn<Run>(async () => '0\n')
    expect((await makeDefaultApp(env({ run }))).ok).toBe(true)
    const args = run.mock.calls[0]?.[1] as unknown as string[]
    expect(args.slice(-2)).toEqual([MAC_CONTENT_TYPE, BUNDLE_ID])
    const refused = await makeDefaultApp(env({ run: vi.fn<Run>(async () => '-54') }))
    expect(refused).toEqual({ ok: false, message: 'macOS hat abgelehnt (Fehler -54).' })
  })

  it('Windows: registers below HKCU, then opens the app page of the default-apps settings', async () => {
    const run = vi.fn<Run>(async () => '')
    const openExternal = vi.fn(async () => undefined)
    const r = await makeDefaultApp(env({ platform: 'win32', run, openExternal }))
    expect(r.ok).toBe(true)
    expect(run).toHaveBeenCalledTimes(windowsRegistration(EXE).length)
    for (const [file, args] of run.mock.calls as unknown as [string, string[]][]) {
      expect(file).toBe('C:\\Windows\\System32\\reg.exe')
      expect(args[0]).toBe('add')
      expect(args[1]).toMatch(/^HKCU\\Software\\/)
    }
    expect(openExternal).toHaveBeenCalledWith(WIN_SETTINGS_URL)
    expect(WIN_SETTINGS_URL).toBe('ms-settings:defaultapps?registeredAppUser=Markdown%20Office')
  })

  it('Windows: the registration opens notes with the app and lists it for .md and .markdown', () => {
    const keys = windowsRegistration(EXE).map((a) => a.join(' '))
    expect(keys).toContain(
      `add HKCU\\Software\\Classes\\MarkdownOffice.md\\shell\\open\\command /ve /d "${EXE}" "%1" /f`,
    )
    expect(keys).toContain(
      'add HKCU\\Software\\Classes\\.md\\OpenWithProgids /v MarkdownOffice.md /t REG_NONE /f',
    )
    expect(keys).toContain(
      'add HKCU\\Software\\Markdown Office\\Capabilities\\FileAssociations /v .markdown /d MarkdownOffice.md /f',
    )
    expect(keys).toContain(
      'add HKCU\\Software\\RegisteredApplications /v Markdown Office /d Software\\Markdown Office\\Capabilities /f',
    )
  })

  it('Windows: a failing reg.exe is reported, the settings stay closed', async () => {
    const openExternal = vi.fn(async () => undefined)
    const run = vi.fn<Run>(async () => Promise.reject(new Error('Zugriff verweigert')))
    const r = await makeDefaultApp(env({ platform: 'win32', run, openExternal }))
    expect(r).toEqual({ ok: false, message: 'Nicht gelungen: Zugriff verweigert' })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('Linux: needs the installed .desktop file', async () => {
    const run = vi.fn<Run>(async () => '')
    const missing = await makeDefaultApp(env({ platform: 'linux', run, exists: () => false }))
    expect(missing.ok).toBe(false)
    expect(run).not.toHaveBeenCalled()
    const exists = vi.fn(() => true)
    const r = await makeDefaultApp(
      env({ platform: 'linux', run, exists, env: { XDG_DATA_HOME: '/x' } }),
    )
    expect(r.ok).toBe(true)
    expect(exists).toHaveBeenCalledWith('/x/applications/markdown-office.desktop')
    expect(run).toHaveBeenCalledWith('xdg-mime', [
      'default',
      'markdown-office.desktop',
      'text/markdown',
    ])
  })
})

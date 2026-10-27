import { execFile } from 'node:child_process'
import { join, win32 } from 'node:path'
import type { DefaultAppResult, DefaultAppStatus } from '../shared/types'

/**
 * „Als Standard für Markdown festlegen“ (settings, owner request 2026-10-27). Electron can only
 * claim URL schemes (`setAsDefaultProtocolClient`), not file types, so every system gets its own
 * way, each with the system's own tool and fixed arguments (execFile, never a shell):
 *
 * - macOS: Launch Services through osascript/JXA (`LSSetDefaultRoleHandlerForContentType` for
 *   `net.daringfireball.markdown`, the type macOS gives `.md`), set directly.
 * - Windows: since Windows 8 no program may set a default itself; Windows only lets the user pick
 *   in Settings → Default apps, and lists only programs registered for the type. The app writes
 *   that registration below HKCU (no admin rights; the same keys as scripts/bootstrap.ps1
 *   `Write-MdoDefaultApp`, whose uninstall removes them) and opens its page in the settings.
 * - Linux: `xdg-mime default markdown-office.desktop text/markdown`; the .desktop file comes from
 *   scripts/bootstrap.sh, so without it there is nothing to point at.
 *
 * Only the packaged app: a dev build would register the Electron binary.
 */

/** The `.md` type on macOS. */
export const MAC_CONTENT_TYPE = 'net.daringfireball.markdown'
/** The packaged app's bundle id (electron-builder.yml `appId`). */
export const BUNDLE_ID = 'io.github.jcmx9.markdownoffice'
/** Windows: the ProgID, capabilities key and registered name; keep in step with bootstrap.ps1. */
export const PROG_ID = 'MarkdownOffice.md'
export const APP_NAME = 'Markdown Office'
export const CAPABILITIES = 'Software\\Markdown Office\\Capabilities'
export const WIN_EXTENSIONS = ['.md', '.markdown'] as const
/** The tag bootstrap.ps1 looks for before it removes a key on uninstall. */
export const DEFAULT_APP_TAG = 'Standardprogramm (Markdown Office)'
/** The .desktop file scripts/bootstrap.sh installs. */
export const DESKTOP_FILE = 'markdown-office.desktop'

/** Runs a program with fixed arguments and returns its stdout; rejects on a non-zero exit. */
export type Run = (file: string, args: readonly string[]) => Promise<string>

export interface DefaultAppEnv {
  platform: NodeJS.Platform
  isPackaged: boolean
  /** The app's executable (Windows registration). */
  execPath: string
  env: NodeJS.ProcessEnv
  home: string
  run: Run
  openExternal(url: string): Promise<void>
  exists(path: string): boolean
}

export const runFile: Run = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { windowsHide: true, timeout: 15_000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(String(stdout))
    })
  })

// Launch Services from JavaScript for Automation; the bundle id and type come in as arguments,
// never spliced into the script.
const MAC_QUERY = `ObjC.import("CoreServices")
function run(argv) {
  const ref = $.LSCopyDefaultRoleHandlerForContentType($(argv[0]), $.kLSRolesAll)
  return ref ? ObjC.unwrap(ObjC.castRefToObject(ref)) : ""
}`
const MAC_SET = `ObjC.import("CoreServices")
function run(argv) {
  return String($.LSSetDefaultRoleHandlerForContentType($(argv[0]), $.kLSRolesAll, $(argv[1])))
}`

const reg = (env: NodeJS.ProcessEnv): string =>
  win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe')

/** The ProgId Windows opens `.md` with for this user, or '' when none was chosen. */
function parseUserChoice(stdout: string): string {
  const m = /^\s*ProgId\s+REG_SZ\s+(.+?)\s*$/m.exec(stdout)
  return m?.[1] ?? ''
}

/** Whether a Windows ProgId points at this app (ours, or picked via „Andere App suchen“). */
export function isOwnProgId(progId: string): boolean {
  return progId === PROG_ID || /\\Markdown Office\.exe$/i.test(progId)
}

/** Every `reg add` the Windows registration needs, as argument lists. */
export function windowsRegistration(execPath: string): string[][] {
  const classes = 'HKCU\\Software\\Classes'
  const prog = `${classes}\\${PROG_ID}`
  const caps = `HKCU\\${CAPABILITIES}`
  const add = (key: string, ...rest: string[]) => ['add', key, ...rest, '/f']
  return [
    add(prog, '/ve', '/d', 'Markdown-Notiz'),
    add(prog, '/v', 'MarkdownOfficeBootstrap', '/d', DEFAULT_APP_TAG),
    add(`${prog}\\DefaultIcon`, '/ve', '/d', `"${execPath}",0`),
    add(`${prog}\\shell\\open\\command`, '/ve', '/d', `"${execPath}" "%1"`),
    ...WIN_EXTENSIONS.map((ext) =>
      add(`${classes}\\${ext}\\OpenWithProgids`, '/v', PROG_ID, '/t', 'REG_NONE'),
    ),
    add(caps, '/v', 'ApplicationName', '/d', APP_NAME),
    add(caps, '/v', 'ApplicationDescription', '/d', 'Markdown-Editor mit PDF-Export'),
    add(caps, '/v', 'MarkdownOfficeBootstrap', '/d', DEFAULT_APP_TAG),
    ...WIN_EXTENSIONS.map((ext) => add(`${caps}\\FileAssociations`, '/v', ext, '/d', PROG_ID)),
    add('HKCU\\Software\\RegisteredApplications', '/v', APP_NAME, '/d', CAPABILITIES),
  ]
}

/** The settings page of this app in Windows 11 (Windows 10 opens the general page). */
export const WIN_SETTINGS_URL = `ms-settings:defaultapps?registeredAppUser=${encodeURIComponent(APP_NAME)}`

function desktopPath(e: DefaultAppEnv): string {
  const data = e.env.XDG_DATA_HOME || join(e.home, '.local', 'share')
  return join(data, 'applications', DESKTOP_FILE)
}

/** Whether this app opens `.md` files by default, as far as the system tells. */
export async function defaultAppStatus(e: DefaultAppEnv): Promise<DefaultAppStatus> {
  if (!e.isPackaged) return { state: 'unknown', platform: e.platform }
  try {
    if (e.platform === 'darwin') {
      const id = (
        await e.run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_QUERY, MAC_CONTENT_TYPE])
      ).trim()
      return { state: id.toLowerCase() === BUNDLE_ID ? 'default' : 'other', platform: e.platform }
    }
    if (e.platform === 'win32') {
      const key =
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.md\\UserChoice'
      // No UserChoice key (nothing picked yet) makes reg.exe fail: not ours.
      const out = await e.run(reg(e.env), ['query', key, '/v', 'ProgId']).catch(() => '')
      return {
        state: isOwnProgId(parseUserChoice(out)) ? 'default' : 'other',
        platform: e.platform,
      }
    }
    if (e.platform === 'linux') {
      const out = (await e.run('xdg-mime', ['query', 'default', 'text/markdown'])).trim()
      return { state: out === DESKTOP_FILE ? 'default' : 'other', platform: e.platform }
    }
  } catch {
    // No answer from the system's tool: the dialog says it cannot tell.
  }
  return { state: 'unknown', platform: e.platform }
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Makes this app the default for `.md` where the system allows it; see the file comment. */
export async function makeDefaultApp(e: DefaultAppEnv): Promise<DefaultAppResult> {
  if (!e.isPackaged) {
    return { ok: false, message: 'Nur in der installierten App möglich.' }
  }
  try {
    if (e.platform === 'darwin') {
      const code = (
        await e.run('/usr/bin/osascript', [
          '-l',
          'JavaScript',
          '-e',
          MAC_SET,
          MAC_CONTENT_TYPE,
          BUNDLE_ID,
        ])
      ).trim()
      return code === '0'
        ? { ok: true, message: 'Markdown-Dateien öffnen jetzt mit Markdown Office.' }
        : { ok: false, message: `macOS hat abgelehnt (Fehler ${code}).` }
    }
    if (e.platform === 'win32') {
      for (const args of windowsRegistration(e.execPath)) await e.run(reg(e.env), args)
      await e.openExternal(WIN_SETTINGS_URL)
      return {
        ok: true,
        message:
          'Windows lässt das nur in den Einstellungen zu: dort bei „.md“ Markdown Office wählen.',
      }
    }
    if (e.platform === 'linux') {
      if (!e.exists(desktopPath(e))) {
        return {
          ok: false,
          message: `${DESKTOP_FILE} fehlt – bitte Markdown Office mit dem Installationsskript installieren.`,
        }
      }
      await e.run('xdg-mime', ['default', DESKTOP_FILE, 'text/markdown'])
      return { ok: true, message: 'Markdown-Dateien öffnen jetzt mit Markdown Office.' }
    }
    return { ok: false, message: 'Auf diesem System nicht möglich.' }
  } catch (err) {
    return { ok: false, message: `Nicht gelungen: ${reason(err)}` }
  }
}

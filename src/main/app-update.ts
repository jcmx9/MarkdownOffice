import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { posix, win32 } from 'node:path'
import type { AppUpdateCheck, AppUpdateOutcome, AppUpdateProgress } from '../shared/types'
import { writeFileAtomic } from './files'

/**
 * Update of the app itself (owner, 2026-10-27). The app is unsigned (macOS only ad hoc), so
 * electron-updater cannot replace it; the bootstrap script verifies a release against
 * SHA256SUMS and swaps the install safely. The app finds a newer stable release, downloads its
 * archive and SHA256SUMS and checks the archive while it still runs, with progress in the
 * notice (owner, 2026-10-29: a minute of background download without feedback made the user
 * reopen the app, and the bootstrap then refused the swap). Then it downloads the bootstrap
 * script of exactly that tag and lets a detached helper run it on the local archive once the
 * app has quit, which takes seconds, and starts the app again.
 */
export const REPO = 'jcmx9/MarkdownOffice'
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASE_PAGE = `https://github.com/${REPO}/releases/`
const DAY = 24 * 60 * 60 * 1000
export const FETCH_TIMEOUT_MS = 30_000
/** The bootstrap scripts are ~50 KB; anything far larger is not ours. */
export const SCRIPT_MAX_BYTES = 1024 * 1024
/** SHA256SUMS lists a handful of files. */
export const SUMS_MAX_BYTES = 64 * 1024
/** The archives are ~150 MB; a download beyond this is not a release of ours. */
export const ARCHIVE_MAX_BYTES = 1024 * 1024 * 1024
/** The archive download may take long on a slow line, but not forever. */
export const ARCHIVE_TIMEOUT_MS = 30 * 60 * 1000
/** A pid file older than this is a leftover (the helper waits at most 5 minutes plus the swap). */
export const PID_MAX_AGE_MS = 15 * 60 * 1000

/**
 * A stable CalVer release (YY.M.MICRO). Checked before a version reaches any URL or helper
 * argument: it comes from the network or the renderer.
 */
export function isReleaseVersion(v: string): boolean {
  return /^\d{2}\.\d{1,2}\.\d+$/.test(v)
}

/** Numeric CalVer comparison: negative when a is older than b. A `-dev.N` suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .split('-')[0]
      ?.split('.')
      .map((n) => Number.parseInt(n, 10)) ?? []
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export interface LatestRelease {
  version: string
  /** The release's page on GitHub („Was ist neu?“). */
  url: string
}

/** The latest stable release from the API answer, or null when it is not one we can trust. */
export function parseLatestRelease(json: unknown): LatestRelease | null {
  if (typeof json !== 'object' || json === null) return null
  const j = json as {
    tag_name?: unknown
    html_url?: unknown
    draft?: unknown
    prerelease?: unknown
  }
  if (j.draft === true || j.prerelease === true) return null
  const version = typeof j.tag_name === 'string' ? j.tag_name.replace(/^v/, '') : ''
  if (!isReleaseVersion(version)) return null
  const url = typeof j.html_url === 'string' ? j.html_url : ''
  // Opened in the browser: only this repo's release pages, never a link the answer brings along.
  return { version, url: url.startsWith(RELEASE_PAGE) ? url : `${RELEASE_PAGE}tag/v${version}` }
}

/** Persisted in <userData>/app-update.json. */
export interface UpdateState {
  /** Time of the last automatic check (ms). */
  lastCheck: number
  /** „Diese Version überspringen“: no automatic banner for this version. */
  skipped: string | null
  /** An install that was handed to the helper; settled at the next start. */
  pending: string | null
}

export const EMPTY_STATE: UpdateState = { lastCheck: 0, skipped: null, pending: null }

export function sanitizeState(raw: unknown): UpdateState {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const version = (v: unknown) => (typeof v === 'string' && isReleaseVersion(v) ? v : null)
  return {
    lastCheck: typeof o.lastCheck === 'number' && Number.isFinite(o.lastCheck) ? o.lastCheck : 0,
    skipped: version(o.skipped),
    pending: version(o.pending),
  }
}

/** Whether an automatic check may run now (a manual one always may, if supported). */
export function autoCheckDue(state: UpdateState, now: number): boolean {
  // A clock set back would otherwise block checks until it caught up again.
  return now - state.lastCheck >= DAY || now < state.lastCheck
}

/** Updates are offered only to released builds: not to a dev run or a `-dev.` pre-release. */
export function updatesSupported(packaged: boolean, version: string): boolean {
  return packaged && isReleaseVersion(version)
}

/** Where the bootstrap script installed the running app, and how to run it for that place. */
export interface InstallLocation {
  platform: 'darwin' | 'linux' | 'win32'
  /** MDO_HOME for the bootstrap, when the install is not at its default place. */
  mdoHome: string | null
  /** Command (and arguments) that starts the app again after the update. */
  relaunch: string[]
}

export interface LocationEnv {
  platform: NodeJS.Platform
  execPath: string
  home: string
  xdgDataHome?: string
  /** Text of a file, or null when it cannot be read. */
  read(path: string): Promise<string | null>
  exists(path: string): Promise<boolean>
}

/**
 * The bootstrap install the app runs from, recognised exactly as bootstrap.sh/.ps1 recognise
 * their own (marker `.mdo-install`). null for any other install (a dev run, an app copied by
 * hand): the script would refuse or install somewhere else, so only „Was ist neu?“ is offered.
 */
export async function installLocation(env: LocationEnv): Promise<InstallLocation | null> {
  if (env.platform === 'darwin') {
    const p = posix
    // <bundle>/Contents/MacOS/Markdown Office
    const bundle = p.resolve(env.execPath, '..', '..', '..')
    if (p.basename(bundle) !== 'Markdown Office.app') return null
    const dir = p.dirname(bundle)
    const owns = async (marker: string) => (await env.read(marker))?.trim() === bundle
    // MDO_HOME install: marker next to the bundle.
    if (await owns(p.join(dir, '.mdo-install')))
      return { platform: 'darwin', mdoHome: dir, relaunch: ['/usr/bin/open', bundle] }
    const data = env.xdgDataHome || p.join(env.home, '.local', 'share')
    if (
      dir === p.join(env.home, 'Applications') &&
      (await owns(p.join(data, 'markdown-office', '.mdo-install')))
    )
      return { platform: 'darwin', mdoHome: null, relaunch: ['/usr/bin/open', bundle] }
    return null
  }
  if (env.platform === 'linux') {
    const p = posix
    const app = p.dirname(env.execPath)
    if (p.basename(env.execPath) !== 'markdown-office' || p.basename(app) !== 'app') return null
    if (!(await env.exists(p.join(app, '.mdo-install')))) return null
    // The command shim sets the bundled libraries' path, like the menu entry.
    const shim = p.join(env.home, '.local', 'bin', 'markdown-office')
    const relaunch = (await env.exists(shim)) ? [shim, '--app'] : [env.execPath]
    return { platform: 'linux', mdoHome: p.dirname(app), relaunch }
  }
  if (env.platform === 'win32') {
    const p = win32
    if (p.basename(env.execPath).toLowerCase() !== 'markdown office.exe') return null
    const dir = p.dirname(env.execPath)
    if (!(await env.exists(p.join(dir, '.mdo-install')))) return null
    return { platform: 'win32', mdoHome: dir, relaunch: [env.execPath] }
  }
  return null
}

/** The bootstrap script of exactly this release (never `main`: the release's own rules). */
export function bootstrapUrl(platform: InstallLocation['platform'], version: string): string {
  if (!isReleaseVersion(version)) throw new Error(`Ungültige Version: ${version}`)
  const file = platform === 'win32' ? 'bootstrap.ps1' : 'bootstrap.sh'
  return `https://raw.githubusercontent.com/${REPO}/v${version}/scripts/${file}`
}

/**
 * The release file the bootstrap installs on this system, named exactly as bootstrap.sh's
 * asset_name and bootstrap.ps1's Get-MdoDownload name it (it checks the archive under that
 * name). null where the bootstrap has no build (Linux ARM, Windows ARM).
 */
export function releaseAsset(
  platform: InstallLocation['platform'],
  arch: string,
  version: string,
): string | null {
  if (!isReleaseVersion(version)) throw new Error(`Ungültige Version: ${version}`)
  if (platform === 'darwin')
    return arch === 'arm64' || arch === 'x64' ? `markdown-office-${version}-mac-${arch}.zip` : null
  if (arch !== 'x64') return null
  return platform === 'linux'
    ? `markdown-office-${version}-linux-x86_64.AppImage`
    : `markdown-office-${version}-win-x64.zip`
}

/** Where the release's files are downloaded from. */
export function releaseFileUrl(version: string, file: string): string {
  if (!isReleaseVersion(version)) throw new Error(`Ungültige Version: ${version}`)
  return `https://github.com/${REPO}/releases/download/v${version}/${file}`
}

/** The SHA-256 SHA256SUMS lists for `file` (also `*file`, binary mode), like the bootstrap. */
export function sumFor(sums: string, file: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim())
    if (m && m[2] === file) return (m[1] ?? '').toLowerCase()
  }
  return null
}

/** A downloaded script must look like ours before it is ever run. */
export function looksLikeBootstrap(platform: InstallLocation['platform'], text: string): boolean {
  if (platform === 'win32') return text.startsWith('<#') && text.includes('Markdown Office')
  return text.startsWith('#!/usr/bin/env bash') && text.includes('Markdown Office')
}

/**
 * Helper for macOS/Linux, run as
 * `sh -c HELPER_SH sh <pid> <script> <version> <log> <archive> <sums> <pidfile> <relaunch…>`:
 * a constant, every value arrives as a positional argument (never pasted into code). Writes
 * its pid to <pidfile> (an app started meanwhile sees the install running and steps aside),
 * waits for the app to exit (at most 5 minutes), runs the bootstrap on the archive the app
 * already downloaded and checked (again while it reports the app as still running: Electron's
 * helper processes end shortly after), logs, removes its files and the pid file and starts the
 * app again (also after a failure: the old version is still in place).
 * Hangup, interrupt and terminate do not stop it: a macOS update died mid-download without a
 * trace (owner, 2026-10-29). The helper logs each such signal; the bootstrap and curl run with
 * them ignored (inherited), so a signal to the whole group cannot cut the download either. A
 * log without the closing `exit` line then means SIGKILL, which nothing can catch.
 */
export const HELPER_SH = `pid="$1"; script="$2"; version="$3"; log="$4"; archive="$5"; sums="$6"
pidfile="$7"; shift 7
echo "$$" >"$pidfile"
echo "mdo-update: helper $$ started ($(date))" >>"$log"
trap 'echo "mdo-update: signal HUP ignored ($(date))" >>"$log"' HUP
trap 'echo "mdo-update: signal INT ignored ($(date))" >>"$log"' INT
trap 'echo "mdo-update: signal TERM ignored ($(date))" >>"$log"' TERM
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1)); [ "$i" -gt 600 ] && break; sleep 0.5
done
n=0
while :; do
  echo "mdo-update: bootstrap --version $version --archive ($(date))" >>"$log"
  (trap '' HUP INT TERM
    exec bash "$script" --version "$version" --archive "$archive" --sums "$sums") >>"$log" 2>&1
  code=$?
  [ "$code" -eq 12 ] && [ "$n" -lt 10 ] || break
  n=$((n + 1)); sleep 1
done
echo "mdo-update: exit $code" >>"$log"
rm -f "$script" "$archive" "$sums" "$pidfile"
"$@" >/dev/null 2>&1 &
`

/** The same for Windows, written to a .ps1 next to the downloaded script (ASCII only, PS 5.1). */
export const HELPER_PS1 = `param([int]$AppPid, [string]$Script, [string]$Version, [string]$Log, [string]$Exe, [string]$Archive, [string]$Sums, [string]$PidFile)
Set-Content -LiteralPath $PidFile -Value $PID -Encoding Ascii
Add-Content -LiteralPath $Log -Value ("mdo-update: helper " + $PID + " started (" + (Get-Date) + ")")
try { Wait-Process -Id $AppPid -Timeout 300 -ErrorAction Stop } catch { }
$code = 0
for ($n = 0; $n -le 10; $n++) {
  Add-Content -LiteralPath $Log -Value ("mdo-update: bootstrap -Version " + $Version + " -Archive (" + (Get-Date) + ")")
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Script -Version $Version -Archive $Archive -Sums $Sums 2>&1 | Out-File -LiteralPath $Log -Append -Encoding utf8
  $code = $LASTEXITCODE
  if ($code -ne 12) { break }
  Start-Sleep -Seconds 1
}
Add-Content -LiteralPath $Log -Value ("mdo-update: exit " + $code)
foreach ($f in @($Script, $Archive, $Sums, $PidFile)) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
Start-Process -FilePath $Exe
`

export interface HelperCommand {
  command: string
  args: string[]
  /** MDO_HOME for the bootstrap; undefined removes an inherited one. */
  mdoHome: string | null
}

export interface HelperFiles {
  pid: number
  script: string
  version: string
  log: string
  /** The checked release archive and its SHA256SUMS, handed to the bootstrap. */
  archive: string
  sums: string
  /** <userData>/update.pid: the helper's pid while it runs. */
  pidFile: string
  /** The written HELPER_PS1 (Windows only). */
  helper?: string
}

/** The detached helper's command line. */
export function helperCommand(loc: InstallLocation, o: HelperFiles): HelperCommand {
  if (!isReleaseVersion(o.version)) throw new Error(`Ungültige Version: ${o.version}`)
  if (loc.platform === 'win32') {
    if (!o.helper) throw new Error('Hilfsskript fehlt')
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        o.helper,
        '-AppPid',
        String(o.pid),
        '-Script',
        o.script,
        '-Version',
        o.version,
        '-Log',
        o.log,
        '-Exe',
        loc.relaunch[0] ?? '',
        '-Archive',
        o.archive,
        '-Sums',
        o.sums,
        '-PidFile',
        o.pidFile,
      ],
      mdoHome: loc.mdoHome,
    }
  }
  return {
    command: '/bin/sh',
    args: [
      '-c',
      HELPER_SH,
      'sh',
      String(o.pid),
      o.script,
      o.version,
      o.log,
      o.archive,
      o.sums,
      o.pidFile,
      ...loc.relaunch,
    ],
    mdoHome: loc.mdoHome,
  }
}

/** What the start reports about an install handed to the helper last time. */
export function settlePending(state: UpdateState, running: string): AppUpdateOutcome | null {
  if (!state.pending) return null
  return compareVersions(running, state.pending) >= 0
    ? { kind: 'updated', version: running }
    : { kind: 'failed', version: state.pending }
}

export type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>

export async function readState(path: string): Promise<UpdateState> {
  try {
    return sanitizeState(JSON.parse(await fs.readFile(path, 'utf8')))
  } catch {
    return { ...EMPTY_STATE }
  }
}

export async function writeState(path: string, state: UpdateState): Promise<void> {
  await writeFileAtomic(path, Buffer.from(`${JSON.stringify(state, null, 2)}\n`))
}

/** One request for the latest stable release. */
export async function fetchLatest(
  fetch: Fetch,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<LatestRelease> {
  const r = await fetch(LATEST, { signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) throw new Error(`Release-Abfrage: HTTP ${r.status}`)
  const rel = parseLatestRelease(await r.json())
  if (!rel) throw new Error('Release ohne gültige Version')
  return rel
}

/** Downloads the release's bootstrap script, size-capped and checked before it is returned. */
export async function fetchBootstrap(
  fetch: Fetch,
  platform: InstallLocation['platform'],
  version: string,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Buffer> {
  const r = await fetch(bootstrapUrl(platform, version), { signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) throw new Error(`Installationsskript: HTTP ${r.status}`)
  const bytes = Buffer.from(await r.arrayBuffer())
  if (bytes.length > SCRIPT_MAX_BYTES) throw new Error('Installationsskript zu groß')
  if (!looksLikeBootstrap(platform, bytes.toString('utf8')))
    throw new Error('Installationsskript unerwartet')
  return bytes
}

/** A file being written, opened exclusively (never over an existing one). */
export interface FileSink {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
}

/** SHA256SUMS of the release, size-capped. */
export async function fetchSums(
  fetch: Fetch,
  version: string,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<string> {
  const r = await fetch(releaseFileUrl(version, 'SHA256SUMS'), {
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!r.ok) throw new Error(`SHA256SUMS: HTTP ${r.status}`)
  const bytes = Buffer.from(await r.arrayBuffer())
  if (bytes.length > SUMS_MAX_BYTES) throw new Error('SHA256SUMS zu groß')
  return bytes.toString('utf8')
}

/**
 * Streams the release archive into `sink`, hashing it on the way, and reports progress. Throws
 * on HTTP errors, an oversized download or a hash that differs from `expected`; the caller
 * removes the partial file.
 */
export async function downloadArchive(
  fetch: Fetch,
  url: string,
  sink: FileSink,
  expected: string,
  onProgress: (received: number, total: number | null) => void,
  signal: AbortSignal,
): Promise<void> {
  const r = await fetch(url, { signal })
  if (!r.ok || !r.body) throw new Error(`Download: HTTP ${r.status}`)
  const length = Number(r.headers.get('content-length'))
  const total = Number.isFinite(length) && length > 0 ? length : null
  if (total !== null && total > ARCHIVE_MAX_BYTES) throw new Error('Archiv zu groß')
  const hash = createHash('sha256')
  let received = 0
  const reader = r.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > ARCHIVE_MAX_BYTES) throw new Error('Archiv zu groß')
      hash.update(value)
      await sink.write(value)
      onProgress(received, total)
    }
  } finally {
    reader.releaseLock()
    await sink.close()
  }
  const actual = hash.digest('hex')
  if (actual !== expected)
    throw new Error('Prüfsumme des Archivs stimmt nicht – nichts wurde verändert.')
}

/** The check's answer for the renderer. */
export function checkResult(
  rel: LatestRelease,
  running: string,
  canInstall: boolean,
): AppUpdateCheck {
  return compareVersions(rel.version, running) > 0
    ? { kind: 'available', version: rel.version, url: rel.url, canInstall }
    : { kind: 'current', version: running }
}

export interface UpdaterDeps {
  /** <userData>/app-update.json */
  statePath: string
  /** <userData>/update.log: the helper's output. */
  logPath: string
  /** <userData>/update.pid: written by the helper while it installs. */
  pidPath: string
  version: string
  packaged: boolean
  /** Setting „Nach Updates suchen“. */
  enabled(): boolean
  fetch: Fetch
  location(): Promise<InstallLocation | null>
  now(): number
  /** process.arch: picks the release archive. */
  arch: string
  /** A new private temp folder for the downloaded files. */
  tempDir(): Promise<string>
  writeFile(path: string, data: Uint8Array): Promise<void>
  /** Opens a new file for the archive (exclusive, private). */
  openFile(path: string): Promise<FileSink>
  removeFile(path: string): Promise<void>
  /** Download progress for the notice. */
  progress(p: AppUpdateProgress): void
  /** The helper's pid from the pid file and the file's age, or null when there is none. */
  readPid(): Promise<{ pid: number; ageMs: number } | null>
  isAlive(pid: number): boolean
  /** Starts the helper detached from the app (it must outlive it). */
  spawn(command: string, args: string[], mdoHome: string | null): void
  pid: number
  /** Quits through the normal close path (unsaved notes are asked about). */
  quit(): void
}

/** An install waiting for the quit: the helper only starts once the app really ends. */
interface Prepared {
  version: string
  command: HelperCommand
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export class AppUpdater {
  private queue: Promise<unknown> = Promise.resolve()
  private prepared: Prepared | null = null
  /** Versions the last check found, so an install request names one the network offered. */
  private offered = new Set<string>()
  /** The archive download under way („Abbrechen“ aborts it). */
  private download: AbortController | null = null

  constructor(private readonly d: UpdaterDeps) {}

  get logPath(): string {
    return this.d.logPath
  }

  /** Serialises every read-modify-write of the state file. */
  private withState<T>(fn: (s: UpdateState) => Promise<T> | T): Promise<T> {
    const run = this.queue.then(async () => fn(await readState(this.d.statePath)))
    this.queue = run.catch(() => undefined)
    return run
  }

  private save(s: UpdateState): Promise<void> {
    return writeState(this.d.statePath, s)
  }

  /**
   * Automatic (at start: setting, day limit and skipped version apply) or manual (menu: always
   * asks). Network errors come back as 'failed'; the automatic caller only logs them.
   */
  check(manual: boolean): Promise<AppUpdateCheck> {
    if (!updatesSupported(this.d.packaged, this.d.version))
      return Promise.resolve({ kind: 'unsupported' })
    return this.withState(async (s) => {
      const now = this.d.now()
      if (!manual && (!this.d.enabled() || !autoCheckDue(s, now))) return { kind: 'skipped' }
      if (!manual) await this.save({ ...s, lastCheck: now })
      let rel: LatestRelease
      try {
        rel = await fetchLatest(this.d.fetch)
      } catch (err) {
        return { kind: 'failed', message: message(err) }
      }
      const canInstall = (await this.d.location().catch(() => null)) !== null
      const r = checkResult(rel, this.d.version, canInstall)
      if (r.kind === 'available') {
        if (!manual && s.skipped === r.version) return { kind: 'skipped' }
        this.offered.add(r.version)
      }
      return r
    })
  }

  /** „Diese Version überspringen“ */
  skip(version: string): Promise<void> {
    if (!isReleaseVersion(version)) return Promise.resolve()
    return this.withState((s) => this.save({ ...s, skipped: version }))
  }

  /** At start: what became of the last install; reported once. */
  outcome(): Promise<AppUpdateOutcome | null> {
    return this.withState(async (s) => {
      const r = settlePending(s, this.d.version)
      if (!r) return null
      await this.save({ ...s, pending: null })
      return r.kind === 'failed' ? { ...r, log: this.d.logPath } : r
    })
  }

  /**
   * „Jetzt aktualisieren“: downloads the release archive and SHA256SUMS with progress, checks
   * the archive, downloads the release's bootstrap script, prepares the helper and quits. The
   * app keeps running (and showing progress) until the archive is checked, so the swap after
   * the quit takes seconds. Returns an error message for the renderer, '' when the user
   * cancelled, or null when the quit is under way.
   */
  async install(version: string): Promise<string | null> {
    if (!isReleaseVersion(version) || !this.offered.has(version))
      return 'Diese Version wurde nicht angeboten.'
    if (this.download) return 'Das Update wird schon geladen.'
    const abort = new AbortController()
    this.download = abort
    let archive: string | null = null
    try {
      const loc = await this.d.location()
      if (!loc) return 'Diese Installation kann sich nicht selbst aktualisieren.'
      const asset = releaseAsset(loc.platform, this.d.arch, version)
      if (!asset) return 'Für dieses System gibt es kein Update-Archiv.'
      const sums = await fetchSums(this.d.fetch, version)
      const expected = sumFor(sums, asset)
      if (!expected) return `SHA256SUMS enthält keinen Eintrag für ${asset}.`
      const dir = await this.d.tempDir()
      const sep = loc.platform === 'win32' ? '\\' : '/'
      archive = `${dir}${sep}${asset}`
      const sink = await this.d.openFile(archive)
      // Whole percents only: the notice is redrawn per step, not per network chunk.
      let shown = -1
      await downloadArchive(
        this.d.fetch,
        releaseFileUrl(version, asset),
        sink,
        expected,
        (received, total) => {
          const percent = total ? Math.floor((received / total) * 100) : null
          if (percent !== null && percent === shown) return
          shown = percent ?? shown
          this.d.progress({ version, received, total })
        },
        AbortSignal.any([abort.signal, AbortSignal.timeout(ARCHIVE_TIMEOUT_MS)]),
      )
      const sumsFile = `${dir}${sep}SHA256SUMS`
      await this.d.writeFile(sumsFile, Buffer.from(sums))
      const bytes = await fetchBootstrap(this.d.fetch, loc.platform, version)
      const script = `${dir}${sep}${loc.platform === 'win32' ? 'bootstrap.ps1' : 'bootstrap.sh'}`
      await this.d.writeFile(script, bytes)
      let helper: string | undefined
      if (loc.platform === 'win32') {
        helper = `${dir}${sep}update-helper.ps1`
        await this.d.writeFile(helper, Buffer.from(HELPER_PS1))
      }
      const command = helperCommand(loc, {
        pid: this.d.pid,
        script,
        version,
        log: this.d.logPath,
        archive,
        sums: sumsFile,
        pidFile: this.d.pidPath,
        helper,
      })
      await this.withState((s) => this.save({ ...s, pending: version }))
      this.prepared = { version, command }
    } catch (err) {
      if (archive) await this.d.removeFile(archive).catch(() => undefined)
      if (abort.signal.aborted) return ''
      return `Update nicht möglich: ${message(err)}`
    } finally {
      this.download = null
    }
    this.d.quit()
    return null
  }

  /** „Abbrechen“ in the notice while the archive downloads. */
  cancelDownload(): void {
    this.download?.abort()
  }

  /**
   * At start: an install handed to the helper is still running (its pid file is fresh and the
   * process lives). The app then steps aside instead of blocking the swap; the helper starts it
   * again afterwards (owner, 2026-10-29: the app was reopened 5 s after quitting).
   */
  async installing(): Promise<boolean> {
    const s = await readState(this.d.statePath)
    if (!s.pending) return false
    const p = await this.d.readPid().catch(() => null)
    if (!p || p.pid === this.d.pid || p.ageMs > PID_MAX_AGE_MS) return false
    return this.d.isAlive(p.pid)
  }

  /** The user kept the app open (unsaved notes): no helper, no pending install. */
  cancelInstall(): void {
    if (!this.prepared) return
    this.prepared = null
    void this.withState((s) => this.save({ ...s, pending: null })).catch((err) =>
      console.warn('app update: state not written', err),
    )
  }

  /** The app is ending for real: hand the prepared install to the detached helper. */
  onWillQuit(): void {
    const p = this.prepared
    if (!p) return
    this.prepared = null
    try {
      this.d.spawn(p.command.command, p.command.args, p.command.mdoHome)
    } catch (err) {
      console.warn('app update: helper did not start', err)
    }
  }
}

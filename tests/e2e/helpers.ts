import { type ChildProcess, execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  test as base,
  type ElectronApplication,
  _electron as electron,
  type Page,
} from '@playwright/test'

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

export interface Dirs {
  root: string
  notes: string
  userData: string
  /** Empty user template folder (MDO_TEMPLATES): never the real ~/Documents. */
  templates: string
}

/** Every app `launch` started in the current test, with its process (taken at launch:
 * `app.process()` throws once the app is closed). */
const launched: { app: ElectronApplication; proc: ChildProcess }[] = []

/** How long a test's leftover app may take to close before its process is killed. */
const CLOSE_TIMEOUT_MS = 10_000

/**
 * Closes an app the test left running (a failed assertion skips the test's own close), and
 * kills its process when the close hangs: no window may outlive its test.
 */
async function shutDown(app: ElectronApplication, proc: ChildProcess): Promise<void> {
  const running = () => proc.exitCode === null && proc.signalCode === null
  if (!running()) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      app.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('close timed out')), CLOSE_TIMEOUT_MS)
      }),
    ])
  } catch {
    // hung or already gone: killed below
  } finally {
    clearTimeout(timer)
  }
  if (running()) proc.kill('SIGKILL')
}

/**
 * Drop-in replacement for Playwright's `test`: every app started via `launch` is traced,
 * and the trace is written to test-results/traces/<test title>.zip only when the test failed.
 * (The built-in `use.trace` does not apply to apps started with `_electron.launch`.)
 * Afterwards every app still running is closed, or killed if that hangs.
 */
export const test = base.extend<{ electronTraces: undefined }>({
  electronTraces: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructuring pattern here
    async ({}, use, testInfo) => {
      launched.length = 0
      await use(undefined)
      const failed = testInfo.status !== testInfo.expectedStatus
      const name = testInfo.titlePath
        .slice(1)
        .join(' ')
        .replace(/[^\w.-]+/g, '_')
        .slice(0, 120)
      let index = 0
      for (const { app, proc } of launched.splice(0)) {
        const path = join('test-results', 'traces', `${name}${index++ ? `-${index}` : ''}.zip`)
        try {
          await app.context().tracing.stop(failed ? { path } : undefined)
        } catch {
          // app already closed by the test: nothing to stop
        }
        await shutDown(app, proc)
      }
    },
    { auto: true },
  ],
})

export interface Launched extends Dirs {
  app: ElectronApplication
  page: Page
}

/**
 * Notes live in a folder with spaces; realpath expands Windows 8.3 names (RUNNER~1). On CI the
 * folder is in RUNNER_TEMP: on the Windows runner that is the checkout's drive (D:), the drive of
 * the pipeline's Typst root, while the default temp folder is on C:.
 */
export async function makeDirs(): Promise<Dirs> {
  const base = process.env.RUNNER_TEMP || tmpdir()
  const root = await realpath(await mkdtemp(join(base, 'mdo-e2e-')))
  const notes = join(root, 'Notizen mit Leerzeichen')
  const userData = join(root, 'user-data')
  const templates = join(root, 'Eigene Vorlagen')
  await mkdir(notes, { recursive: true })
  await mkdir(userData, { recursive: true })
  await mkdir(templates, { recursive: true })
  return { root, notes, userData, templates }
}

/**
 * Launch-hang diagnostics. On macOS CI, `firstWindow` sometimes times out after 30 s: the
 * Electron process starts (Playwright connects), but no window ever appears, and the app
 * does not quit on `close` either. 6 of the 7 hangs seen up to 2026-10-22 came right after
 * a test that closed its app in Present, i.e. after leaving a real fullscreen Space
 * (present.spec.ts:73 → :110, :220 → :238); one followed a spellcheck test. The cause is not
 * known yet, so a hang prints what tells the candidates apart: is an earlier app of this
 * worker still alive, how long ago did the last one exit, did the main process get Electron's
 * `ready` and create a window, does it answer at all, its output, and on macOS a native
 * stack sample of the stuck process.
 */
interface Started {
  proc: ChildProcess
  title: string
  at: number
  exited: number | null
  output: string[]
}

/** Every app this worker started, oldest first (pids and exit times only, kept small). */
const history: Started[] = []
const HISTORY_LIMIT = 20
/** Output kept per app: the tail is what matters. */
const OUTPUT_LIMIT = 200

function track(proc: ChildProcess): Started {
  const entry: Started = {
    proc,
    title: test.info().titlePath.slice(1).join(' › '),
    at: Date.now(),
    exited: null,
    output: [],
  }
  // Only the output after launch: Playwright reads the stream up to "DevTools listening".
  const keep = (chunk: Buffer) => {
    entry.output.push(...chunk.toString('utf8').split(/\r?\n/).filter(Boolean))
    if (entry.output.length > OUTPUT_LIMIT)
      entry.output.splice(0, entry.output.length - OUTPUT_LIMIT)
  }
  proc.stdout?.on('data', keep)
  proc.stderr?.on('data', keep)
  proc.once('exit', () => {
    entry.exited = Date.now()
  })
  history.push(entry)
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)
  return entry
}

function alive(pid: number | undefined): boolean {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Runs a diagnostic tool (no shell); its failure is reported, never thrown. */
function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      resolve(err ? `${cmd} failed: ${err.message}\n${out}` : out)
    })
  })
}

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T | string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise.catch((err: unknown) => `${what} failed: ${String(err)}`),
    new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve(`${what}: no answer within ${ms} ms`), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

async function launchHangReport(
  app: ElectronApplication,
  proc: ChildProcess,
  started: Started,
): Promise<string> {
  const now = Date.now()
  const lines = [
    '=== launch hang: no window ===',
    `pid ${proc.pid}, ${now - started.at} ms after launch, running: ${alive(proc.pid)}`,
    'earlier apps of this worker:',
  ]
  for (const e of history) {
    if (e === started) continue
    const state = alive(e.proc.pid)
      ? 'STILL RUNNING'
      : `exited ${e.exited === null ? '(time unknown)' : `${now - e.exited} ms ago, ${started.at - e.exited} ms before this launch`}`
    lines.push(`  pid ${e.proc.pid} ${state} — ${e.title}`)
  }
  // Under Playwright, app.isReady() turns true only once Electron's real `ready` arrived (its
  // loader holds the event back until it is connected). No answer: the main thread is stuck.
  const state = await within(
    app.evaluate(({ app: a, BrowserWindow, webContents }) => ({
      ready: a.isReady(),
      uptime: process.uptime(),
      windows: BrowserWindow.getAllWindows().map((w) => ({
        visible: w.isVisible(),
        fullScreen: w.isFullScreen(),
        url: w.webContents.getURL(),
        loading: w.webContents.isLoading(),
      })),
      webContents: webContents.getAllWebContents().length,
    })),
    5000,
    'main process state',
  )
  lines.push(`main process: ${typeof state === 'string' ? state : JSON.stringify(state)}`)
  if (process.platform === 'darwin' && proc.pid !== undefined) {
    const ps = await run('ps', ['-axo', 'pid,ppid,etime,state,command'], 5000)
    lines.push('Electron processes:')
    lines.push(
      ...ps
        .split('\n')
        .filter((l) => /Electron/.test(l))
        .map((l) => `  ${l.slice(0, 220)}`),
    )
    // The main thread comes first in the call graph; its top 150 lines show where it waits.
    const sample = await run('sample', [String(proc.pid), '1'], 10_000)
    const graph = sample.indexOf('Call graph:')
    lines.push('main-thread sample:')
    lines.push(...(graph < 0 ? sample : sample.slice(graph)).split('\n').slice(0, 150))
  }
  lines.push(`app output since launch (last ${OUTPUT_LIMIT} lines):`, ...started.output)
  lines.push('=== end launch hang ===')
  return lines.join('\n')
}

export async function launch(
  opts: {
    args?: string[]
    settings?: Record<string, unknown>
    env?: Record<string, string>
    dirs?: Dirs
  } = {},
): Promise<Launched> {
  const dirs = opts.dirs ?? (await makeDirs())
  await writeFile(
    join(dirs.userData, 'settings.json'),
    // Never the real ~/Documents/Markdown Office/Snippets: a folder in the temp root (not created).
    JSON.stringify({
      defaultFolder: dirs.notes,
      snippetFolder: join(dirs.root, 'Snippets'),
      ...opts.settings,
    }),
  )
  // Exports run the real bundled pipeline (dev layout): no PDF viewer, no real user sets.
  const env = {
    ...process.env,
    MDO_USER_DATA: dirs.userData,
    MDO_NO_OPEN: '1',
    MDO_TEMPLATES: dirs.templates,
    // Locally the fullscreen is only simulated: a failed or killed run must never leave a
    // real macOS fullscreen Space on the developer's screen. CI tests the real one.
    ...(process.env.CI ? {} : { MDO_E2E_FAKE_FULLSCREEN: '1' }),
    ...opts.env,
  } as Record<string, string>
  const app = await electron.launch({ args: ['.', ...(opts.args ?? [])], env })
  const proc = app.process()
  const started = track(proc)
  await app.context().tracing.start({ screenshots: true, snapshots: true })
  launched.push({ app, proc })
  let page: Page
  try {
    page = await app.firstWindow()
  } catch (err) {
    // CI passes on the retry, and only failed runs keep artifacts: the report goes to the log.
    // Room for the report and the teardown's close/kill after the 30 s already spent.
    test.info().setTimeout(test.info().timeout + 30_000)
    const report = await launchHangReport(app, proc, started)
    console.log(report)
    await test.info().attach('launch-hang', { body: report, contentType: 'text/plain' })
    throw err
  }
  await page.locator('.cm-editor').waitFor()
  await page.locator('[data-testid=tab]').first().waitFor()
  return { ...dirs, app, page }
}

/** Menu accelerators do not fire for synthetic key events, so click the item. */
export async function clickMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId)
    if (!item) throw new Error(`menu item ${menuId} missing`)
    item.click()
  }, id)
}

export async function waitForFile(
  path: string,
  accept: (b: Buffer) => boolean = () => true,
  timeoutMs = 5000,
): Promise<Buffer> {
  const end = Date.now() + timeoutMs
  for (;;) {
    try {
      const b = await readFile(path)
      if (accept(b)) return b
    } catch {
      // not there yet
    }
    if (Date.now() > end) throw new Error(`timeout waiting for ${path}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

export async function typeInEditor(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press(`${MOD}+End`)
  await page.keyboard.type(text)
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: join('test-results', 'screenshots', `${process.platform}-${name}.png`),
  })
}

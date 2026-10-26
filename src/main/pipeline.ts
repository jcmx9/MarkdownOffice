import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import type { ExportResult } from '../shared/types'

/** Where the bundled pipeline lives: the same layout packaged and in development. */
export interface PipelinePaths {
  /** Folder with build.sh / convert.ps1, cli.js, lib/, vendor/, fonts/ and bin/typst. */
  root: string
  /** Bundled template sets as <name>/<name>.typ. */
  sets: string
  cli: string
  fonts: string
}

/**
 * Packaged: `<resources>/pipeline` and `<resources>/sets`. Development: the layout that
 * `npm run assets` builds below `<appRoot>/build/pipeline-dev` (pipeline/tests/dev-layout.sh).
 */
export function pipelinePaths(
  isPackaged: boolean,
  resourcesPath: string,
  appRoot: string,
): PipelinePaths {
  const base = isPackaged ? resourcesPath : join(appRoot, 'build', 'pipeline-dev')
  const root = join(base, 'pipeline')
  return { root, sets: join(base, 'sets'), cli: join(root, 'cli.js'), fonts: join(root, 'fonts') }
}

const DEFAULT_TIMEOUT_MS = 120_000

function lastLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? ''
  )
}

const KILL_GRACE_MS = 2000

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // The group is already gone; nothing left to signal.
  }
}

/** Ends a detached child and everything it started (also used by the formula renderer). */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    // A failure to start taskkill must not become an unhandled error in the main process.
    killer.on('error', () => {})
    return
  }
  // The child leads its own process group (detached), so this reaches the whole tree.
  const pid = child.pid
  signalGroup(pid, 'SIGTERM')
  const escalate = setTimeout(() => signalGroup(pid, 'SIGKILL'), KILL_GRACE_MS)
  escalate.unref()
}

export interface RunOptions {
  paths: PipelinePaths
  /** The app version, passed as MDO_VERSION (PDF keywords). */
  version: string
  timeoutMs?: number
  /** The runtime for cli.js; default: this process's own binary (Electron as Node). */
  execPath?: string
  /**
   * The user's templates folder as main resolved it (absolute), passed as MDO_TEMPLATES. Without
   * it the pipeline derives its own (`$HOME/Markdown Office/…` or a kept
   * `$HOME/Documents/Markdown Office/…` in build.sh, a relative MDO_TEMPLATES from the note's
   * folder), which can differ from the folder the set picker listed — e.g. on Linux with a kept
   * folder in a localised XDG documents folder (`~/Dokumente`).
   */
  templatesDir?: string
}

/**
 * Exports `note` through the bundled pipeline: `cli.js <note>` under this process's binary with
 * ELECTRON_RUN_AS_NODE=1. The pipeline names the PDF, reads the front matter and opens it.
 */
export function runPipeline(note: string, opts: RunOptions): Promise<ExportResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: ExportResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const child = spawn(opts.execPath ?? process.execPath, [opts.paths.cli, note], {
      cwd: dirname(note),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        MDO_PIPELINE_ROOT: opts.paths.root,
        MDO_SETS_DIR: opts.paths.sets,
        MDO_VERSION: opts.version,
        ...(opts.templatesDir ? { MDO_TEMPLATES: opts.templatesDir } : {}),
      },
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    const timer = setTimeout(() => {
      killTree(child)
      const seconds = Math.round(timeoutMs / 1000)
      finish({
        kind: 'failed',
        code: null,
        stderr:
          `${stderr.trim()}\nZeitüberschreitung: Export nach ${seconds} s abgebrochen.`.trim(),
      })
    }, timeoutMs)
    child.stdout?.setEncoding('utf8').on('data', (d: string) => {
      stdout += d
    })
    child.stderr?.setEncoding('utf8').on('data', (d: string) => {
      stderr += d
    })
    child.on('error', (err) => {
      finish({
        kind: 'failed',
        code: null,
        stderr: `Export konnte nicht gestartet werden: ${err.message}`,
      })
    })
    child.on('close', (code) => {
      if (code === 0) {
        finish({ kind: 'ok', message: lastLine(stdout) || 'PDF erzeugt.' })
      } else {
        finish({
          kind: 'failed',
          code,
          stderr: stderr.trim() || `Export endete mit Code ${code}.`,
        })
      }
    })
  })
}

const VERSION_TIMEOUT_MS = 5000

/** The version from `typst --version` output: first line, first version-like token. */
export function parseTypstVersion(output: string): string | null {
  const first = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean)
  if (!first) return null
  return /\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/.exec(first)?.[0] ?? first
}

/**
 * Runs the bundled `<root>/bin/typst --version` for the settings dialog. Null when it is
 * missing, fails or does not answer within the timeout.
 */
export function typstVersion(
  root: string,
  opts: { timeoutMs?: number; platform?: NodeJS.Platform } = {},
): Promise<string | null> {
  const win = (opts.platform ?? process.platform) === 'win32'
  const bin = join(root, 'bin', win ? 'typst.exe' : 'typst')
  return new Promise((resolve) => {
    execFile(
      bin,
      ['--version'],
      {
        timeout: opts.timeoutMs ?? VERSION_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        windowsHide: true,
        encoding: 'utf8',
      },
      (err, stdout) => resolve(err ? null : parseTypstVersion(stdout)),
    )
  })
}

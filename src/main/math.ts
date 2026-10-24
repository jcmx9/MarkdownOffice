import { type ChildProcess, spawn } from 'node:child_process'
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MATH_PROGRAM,
  MATH_REF_PT,
  type MathItem,
  type MathResult,
  pagesPerItem,
  svgSizePt,
} from '../core/math'
import { killTree } from './pipeline'

/** One batch rarely takes 0.3 s (the cost is process start); 10 s only stops a runaway formula. */
const DEFAULT_TIMEOUT_MS = 10_000
/** Upper bound for one render() call including the search for failing formulas. */
const DEFAULT_DEADLINE_MS = 30_000
/** How long a killed Typst may take to exit before the result is given anyway (killTree: 2 s). */
const CLOSE_GRACE_MS = 2500

const MISSING = 'Typst nicht gefunden'
const ABORTED = 'abgebrochen'
const TIMEOUT = 'Zeitüberschreitung'
const TYPST_CODE = 'Typst-Code in Formeln wird in der Vorschau nicht ausgeführt'

/**
 * Defense in depth, not the boundary. Some mitex commands pass formula text into Typst code
 * (eval or raw `#…` output), so a formula can run Typst. As of mitex 0.2.7: `\iftypst … \fi`,
 * `\includegraphics` (options and path emitted raw), `\hspace`/`\vspace` and `\raisebox`
 * (their `\text{…}` argument is evaluated, specs/latex/standard.typ). The preview refuses these
 * before compiling. The list is not exhaustive: the security boundary is the sandbox (root = a
 * temp dir with only mitex and this batch, empty package dirs, dead proxy, timeout). A mitex
 * update must re-check specs/latex/standard.typ for eval and raw output.
 */
const RAW_TYPST = /\\(iftypst|includegraphics|hspace|vspace|raisebox)(?![A-Za-z])/

/** A dead local port: any network access Typst tries (package download) fails at once. */
const DEAD_PROXY = 'http://127.0.0.1:9'
const PROXY_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY']

/**
 * The environment Typst runs with: the app's (PATH, SystemRoot … keep Windows working) without
 * any TYPST_* setting (package path, cert, fonts from outside) and with every proxy variable on
 * a dead port, so no formula can make Typst reach the network.
 */
export function mathEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    const upper = key.toUpperCase()
    // Case-insensitive (Windows): no stray `Https_Proxy` may survive next to ours.
    if (upper.startsWith('TYPST_') || PROXY_KEYS.includes(upper)) continue
    out[key] = value
  }
  for (const key of PROXY_KEYS) {
    const value = key === 'NO_PROXY' ? '' : DEAD_PROXY
    out[key] = value
    out[key.toLowerCase()] = value
  }
  return out
}

type Compiled = { ok: true; pages: string[] } | { ok: false; error: string }

const fail = (items: readonly unknown[], error: string): MathResult[] =>
  items.map(() => ({ ok: false, error }))

/** Typst's first `error:` line without the prefix (the message, not the source excerpt). */
function firstError(stderr: string, code: number | null): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const line = lines.find((l) => l.startsWith('error:')) ?? lines.at(-1)
  return line ? line.replace(/^error:\s*/, '') : `Typst endete mit Code ${code}.`
}

/**
 * Renders formula batches for the preview with the bundled Typst and mitex, the same toolchain
 * the PDF export runs (src/core/math.ts has the program and the metrics). Lives in main because
 * the renderer is sandboxed; one instance per app.
 *
 * Process hygiene as the export: one run at a time (a call waits for the running one), a timeout
 * that kills the process tree, no shell, no window. Each run gets a fresh temp dir that is also
 * Typst's `--root` and holds its package dirs, so `read()`/`image()`/imports reach nothing
 * outside it; it is removed afterwards.
 */
export class MathRenderer {
  private readonly timeoutMs: number
  private readonly deadlineMs: number
  private readonly spawnImpl: typeof spawn
  private queue: Promise<unknown> = Promise.resolve()
  /** Bumped by dispose(): runs queued or running under an older generation are abandoned. */
  private generation = 0
  private running: ChildProcess | null = null

  constructor(
    /** The bundled pipeline folder (bin/typst, fonts/, vendor/mitex), as the export uses it. */
    private readonly root: string,
    opts: { timeoutMs?: number; deadlineMs?: number; spawnImpl?: typeof spawn } = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS
    this.spawnImpl = opts.spawnImpl ?? spawn
  }

  /** One result per item, in order; never rejects (failures are per-item results). */
  render(items: readonly MathItem[]): Promise<MathResult[]> {
    // Nothing to set: no process for an empty preview.
    if (!items.length) return Promise.resolve([])
    const generation = this.generation
    const run = this.queue.then(() =>
      generation === this.generation ? this.run(items, generation) : fail(items, ABORTED),
    )
    this.queue = run.catch(() => undefined)
    return run
  }

  /**
   * Kills the running Typst and answers every queued render with `abgebrochen` (window closed,
   * app quitting). Later calls render again.
   */
  dispose(): void {
    this.generation++
    if (this.running) killTree(this.running)
  }

  private async run(items: readonly MathItem[], generation: number): Promise<MathResult[]> {
    const results: (MathResult | undefined)[] = items.map((item) =>
      RAW_TYPST.test(item.tex) ? { ok: false, error: TYPST_CODE } : undefined,
    )
    const todo = items.flatMap((item, i) => (results[i] ? [] : [{ item, i }]))
    if (!todo.length) return results as MathResult[]
    const bin = join(this.root, 'bin', process.platform === 'win32' ? 'typst.exe' : 'typst')
    try {
      await access(bin)
    } catch {
      for (const { i } of todo) results[i] = { ok: false, error: MISSING }
      return results as MathResult[]
    }
    let tmp: string | null = null
    try {
      tmp = await mkdtemp(join(tmpdir(), 'mdo-math-'))
      // mitex inside the root (the program imports "mitex/lib.typ"); symlinks are skipped so
      // nothing in the copy points outside the root.
      await cp(join(this.root, 'vendor', 'mitex'), join(tmp, 'mitex'), {
        recursive: true,
        filter: async (src) => !(await lstat(src)).isSymbolicLink(),
      })
      // Empty package dirs of this run: no import can read the user's packages or fill their cache.
      await mkdir(join(tmp, 'pkg'))
      await mkdir(join(tmp, 'pkg-cache'))
      await writeFile(join(tmp, 'main.typ'), MATH_PROGRAM)
      const dir = tmp
      const deadline = Date.now() + this.deadlineMs
      const solve = async (part: typeof todo): Promise<void> => {
        const set = (error: string) => {
          for (const { i } of part) results[i] = { ok: false, error }
        }
        if (generation !== this.generation) return set(ABORTED)
        const left = deadline - Date.now()
        if (left <= 0) return set(TIMEOUT)
        const timeout = Math.min(this.timeoutMs, left)
        const res = await this.compile(
          bin,
          dir,
          part.map((p) => p.item),
          timeout,
          generation,
        )
        if (generation !== this.generation) return set(ABORTED)
        if (res.ok) {
          const mapped = mapPages(
            part.map((p) => p.item),
            res.pages,
          )
          part.forEach(({ i }, k) => {
            results[i] = mapped[k]
          })
          return
        }
        if (part.length === 1) return set(res.error)
        // No time left to isolate the culprit: the batch's error is not these items' own.
        if (Date.now() >= deadline) return set(TIMEOUT)
        // One formula Typst rejects (or that hangs) fails the whole compile: halve until the
        // culprits stand alone, so k bad of n cost about 2·k·log2(n) runs instead of n.
        const mid = Math.ceil(part.length / 2)
        await solve(part.slice(0, mid))
        await solve(part.slice(mid))
      }
      await solve(todo)
      return results as MathResult[]
    } catch (err) {
      const error = `Formelsatz fehlgeschlagen: ${err instanceof Error ? err.message : err}`
      for (const { i } of todo) results[i] ??= { ok: false, error }
      return results as MathResult[]
    } finally {
      // A killed child may still hold a file on Windows; a leftover temp dir is not an error.
      if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** One Typst run over `items` in `dir`; the SVG pages in page order. */
  private async compile(
    bin: string,
    dir: string,
    items: readonly MathItem[],
    timeoutMs: number,
    generation: number,
  ): Promise<Compiled> {
    for (const f of await readdir(dir)) if (/^out-\d+\.svg$/.test(f)) await rm(join(dir, f))
    await writeFile(join(dir, 'formulas.json'), JSON.stringify(items))
    // A dispose() while the temp dir was being prepared: never start Typst for it.
    if (generation !== this.generation) return { ok: false, error: ABORTED }
    // null: Typst finished without an error and wrote the pages.
    const failed = await new Promise<Compiled | null>((resolve) => {
      let stderr = ''
      let settled = false
      let timedOut = false
      const finish = (v: Compiled | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.running = null
        resolve(v)
      }
      const timeoutResult: Compiled = { ok: false, error: TIMEOUT }
      const args = [
        'compile',
        '--root',
        dir,
        '--package-path',
        join(dir, 'pkg'),
        '--package-cache-path',
        join(dir, 'pkg-cache'),
        '--font-path',
        join(this.root, 'fonts'),
        '--ignore-system-fonts',
        '--format',
        'svg',
        'main.typ',
        'out-{0p}.svg',
      ]
      const child = this.spawnImpl(bin, args, {
        cwd: dir,
        env: mathEnv(process.env),
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        // Own process group, so killTree reaches everything (as the export).
        detached: process.platform !== 'win32',
      })
      this.running = child
      const timer = setTimeout(() => {
        timedOut = true
        killTree(child)
        // Wait for the exit so the next run never overlaps the killed one; bounded by the grace.
        setTimeout(() => finish(timeoutResult), CLOSE_GRACE_MS).unref()
      }, timeoutMs)
      child.stderr?.setEncoding('utf8').on('data', (d: string) => {
        stderr += d
      })
      child.on('error', (err: NodeJS.ErrnoException) =>
        finish({ ok: false, error: err.code === 'ENOENT' ? MISSING : err.message }),
      )
      child.on('close', (c) => {
        if (timedOut) finish(timeoutResult)
        else finish(c === 0 ? null : { ok: false, error: firstError(stderr, c) })
      })
    })
    if (failed) return failed
    // `{0p}` pads page numbers to the page count's digits (out-01 … out-10): sort numerically.
    const files = (await readdir(dir))
      .map((f) => /^out-(\d+)\.svg$/.exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => Number(a[1]) - Number(b[1]))
    const pages = await Promise.all(files.map((m) => readFile(join(dir, m[0]), 'utf8')))
    return { ok: true, pages }
  }
}

/**
 * Pages back to items (MATH_PROGRAM's order): a display formula is one page; an inline formula
 * is its bounds page (the SVG shown) and a baseline page that only gives its height, so the
 * depth below the baseline is the difference. Sizes in em of MATH_REF_PT.
 */
function mapPages(items: readonly MathItem[], pages: readonly string[]): MathResult[] {
  const expected = items.reduce((n, item) => n + pagesPerItem(item), 0)
  if (pages.length !== expected)
    return fail(items, `Typst lieferte ${pages.length} statt ${expected} Seiten`)
  let i = 0
  return items.map((item): MathResult => {
    const svg = pages[i] ?? ''
    const size = svgSizePt(svg)
    const base = pagesPerItem(item) === 2 ? svgSizePt(pages[i + 1] ?? '') : size
    i += pagesPerItem(item)
    if (!size || !base) return { ok: false, error: 'Typst-SVG ohne Größe' }
    return {
      ok: true,
      svg,
      width: size.width / MATH_REF_PT,
      height: size.height / MATH_REF_PT,
      depth: item.display ? 0 : Math.max(0, size.height - base.height) / MATH_REF_PT,
    }
  })
}

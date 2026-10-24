import { type ChildProcess, spawn } from 'node:child_process'
import { access, cp, lstat, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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

const MISSING = 'Typst nicht gefunden'
const ABORTED = 'abgebrochen'

type Compiled = { ok: true; pages: string[] } | { ok: false; error: string; timeout?: true }

const fail = (items: readonly MathItem[], error: string): MathResult[] =>
  items.map(() => ({ ok: false, error }))

/** Typst's first `error:` line (the message without the source excerpt below it). */
function firstError(stderr: string, code: number | null): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return (
    lines.find((l) => l.startsWith('error:')) ?? lines.at(-1) ?? `Typst endete mit Code ${code}.`
  )
}

/**
 * Renders formula batches for the preview with the bundled Typst and mitex, the same toolchain
 * the PDF export runs (src/core/math.ts has the program and the metrics). Lives in main because
 * the renderer is sandboxed; one instance per app.
 *
 * Process hygiene as the export: one run at a time (a call waits for the running one), a timeout
 * that kills the process tree, no shell, no window. Each run gets a fresh temp dir that is also
 * Typst's `--root`, so `read()`/`image()` reach nothing outside it, and it is removed afterwards.
 */
export class MathRenderer {
  private readonly timeoutMs: number
  private readonly spawnImpl: typeof spawn
  private queue: Promise<unknown> = Promise.resolve()
  /** Bumped by dispose(): runs queued or running under an older generation are abandoned. */
  private generation = 0
  private running: ChildProcess | null = null

  constructor(
    /** The bundled pipeline folder (bin/typst, fonts/, vendor/mitex), as the export uses it. */
    private readonly root: string,
    opts: { timeoutMs?: number; spawnImpl?: typeof spawn } = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
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
    const bin = join(this.root, 'bin', process.platform === 'win32' ? 'typst.exe' : 'typst')
    try {
      await access(bin)
    } catch {
      return fail(items, MISSING)
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
      await writeFile(join(tmp, 'main.typ'), MATH_PROGRAM)
      const dir = tmp
      const batch = await this.compile(bin, dir, items)
      if (generation !== this.generation) return fail(items, ABORTED)
      if (batch.ok) return mapPages(items, batch.pages)
      // A timeout would only repeat per formula; a single item already has its own error.
      if (batch.timeout || items.length === 1) return fail(items, batch.error)
      // One formula Typst rejects fails the whole compile: set each alone to find the culprit(s),
      // the others still render.
      const out: MathResult[] = []
      for (const item of items) {
        if (generation !== this.generation) {
          out.push({ ok: false, error: ABORTED })
          continue
        }
        const single = await this.compile(bin, dir, [item])
        if (generation !== this.generation) out.push({ ok: false, error: ABORTED })
        else if (single.ok) out.push(...mapPages([item], single.pages))
        else out.push({ ok: false, error: single.error })
      }
      return out
    } catch (err) {
      return fail(items, `Formelsatz fehlgeschlagen: ${err instanceof Error ? err.message : err}`)
    } finally {
      // A killed child may still hold a file on Windows; a leftover temp dir is not an error.
      if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** One Typst run over `items` in `dir`; the SVG pages in page order. */
  private async compile(bin: string, dir: string, items: readonly MathItem[]): Promise<Compiled> {
    for (const f of await readdir(dir)) if (/^out-\d+\.svg$/.test(f)) await rm(join(dir, f))
    await writeFile(join(dir, 'formulas.json'), JSON.stringify(items))
    // null: Typst finished without an error and wrote the pages.
    const failed = await new Promise<Compiled | null>((resolve) => {
      let stderr = ''
      let settled = false
      const finish = (v: Compiled | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.running = null
        resolve(v)
      }
      const args = [
        'compile',
        '--root',
        dir,
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
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        // Own process group, so killTree reaches everything (as the export).
        detached: process.platform !== 'win32',
      })
      this.running = child
      const timer = setTimeout(() => {
        killTree(child)
        finish({
          ok: false,
          error: `Zeitüberschreitung nach ${this.timeoutMs / 1000} s`,
          timeout: true,
        })
      }, this.timeoutMs)
      child.stderr?.setEncoding('utf8').on('data', (d: string) => {
        stderr += d
      })
      child.on('error', (err: NodeJS.ErrnoException) =>
        finish({ ok: false, error: err.code === 'ENOENT' ? MISSING : err.message }),
      )
      child.on('close', (c) => finish(c === 0 ? null : { ok: false, error: firstError(stderr, c) }))
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

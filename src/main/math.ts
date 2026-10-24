import { type ChildProcess, execFile, spawn } from 'node:child_process'
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MATH_PROGRAM,
  MATH_REF_PT,
  MATH_REFUSED,
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
/** Resident memory a formula run may use; a normal batch stays far below (~100 MB). */
const DEFAULT_MAX_RSS_BYTES = 1024 ** 3
/** How often the memory watchdog asks for the run's resident size. */
const RSS_POLL_MS = 250
/** Total SVG a run may write back: a batch of 500 ordinary formulas is a few MB. */
const DEFAULT_MAX_SVG_BYTES = 20 * 1024 * 1024
/** stderr kept for the error message (Typst's first error is at the top). */
const MAX_STDERR = 64 * 1024

const MISSING = 'Typst nicht gefunden'
const ABORTED = 'abgebrochen'
const TIMEOUT = 'Zeitüberschreitung'
const TYPST_CODE = 'Typst-Code in Formeln wird in der Vorschau nicht ausgeführt'
const TOO_MUCH_MEMORY = 'Formel braucht zu viel Speicher'
const TOO_LARGE = 'Formel zu groß für die Vorschau'

/**
 * Defense in depth, not the boundary. Some mitex commands pass formula text into Typst code
 * (eval or raw `#…` output), so a formula can run Typst. As of mitex 0.2.7: `\iftypst … \fi`,
 * `\includegraphics` (options and path emitted raw), `\hspace`/`\vspace` and `\raisebox`
 * (their `\text{…}` argument is evaluated, specs/latex/standard.typ). The preview refuses these
 * before compiling. The list is not exhaustive: the security boundary is the sandbox (root = a
 * temp dir with only mitex and this batch, empty package dirs, dead proxy, timeout, memory
 * watchdog); MATH_PROGRAM checks the converted output as a second layer. A mitex update must
 * re-check specs/latex/standard.typ for eval and raw output (the pin test in tests/unit/main/math.test.ts).
 */
const RAW_TYPST = /\\(iftypst|includegraphics|hspace|vspace|raisebox)(?![A-Za-z])/
/**
 * A `#` no backslash escapes (an even run of backslashes before it). TeX has no use for one in
 * a formula, and in text mode mitex 0.2.7 copies `\label{…}`'s argument raw into its output, so
 * `\text{\label{#panic(…)}}` would be Typst code.
 */
const BARE_HASH = /(?:^|[^\\])(?:\\\\)*#/
/** Whitespace and TeX comments mitex skips between a command and its argument. */
const GAP = String.raw`(?:\s|%[^\n]*(?:\n|$))*`
/**
 * `\label` whose argument is not a plain label name: in text mode mitex writes it raw as
 * `<…>`, where `]`, `$` or `>` leave the label and land in Typst markup or code (also inside a
 * `\textcolor{…}` or a figure caption, which are code arguments). Also a `\label` without a
 * braced argument (`\newcommand{\x}{\label}` would alias it). Letters and digits of any script
 * are plain (`\label{eq:Ü}`): none of them can leave the label; punctuation stays limited to
 * `_ : . -` and space.
 */
const UNSAFE_LABEL = new RegExp(
  String.raw`\\label(?![A-Za-z])(?!${GAP}\{[\p{L}\p{N}_:. -]*\})`,
  'u',
)
/**
 * A colour command whose optional model is not plain letters: mitex 0.2.7 emits the model raw
 * as a code argument (`\color[{x], panic(1), [y}]{red}` runs `panic`). A command without its
 * argument is refused too, so a `\newcommand` alias cannot hide one.
 */
const UNSAFE_COLOR = new RegExp(
  String.raw`\\(?:color|textcolor|colorbox)(?![A-Za-z])(?!${GAP}(?:\{|\[[A-Za-z]*\]))`,
)

/** True when the source holds one of the known ways into Typst code (see the patterns above). */
export function runsTypstCode(tex: string): boolean {
  return (
    RAW_TYPST.test(tex) || BARE_HASH.test(tex) || UNSAFE_LABEL.test(tex) || UNSAFE_COLOR.test(tex)
  )
}

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

/**
 * One Typst run's outcome. `formula`: the failure points into a formula (a source location in
 * the program or mitex, the refusal marker, a per-run limit), so halving the batch can isolate
 * it; otherwise (Typst cannot start, crashes on load) every run fails the same way.
 */
type Compiled = { ok: true; pages: string[] } | { ok: false; error: string; formula: boolean }

/** Resident size of process `pid` in bytes, or null when it cannot be read (exited). */
export type RssProbe = (pid: number) => Promise<number | null>

/**
 * `ps -o rss= -p <pid>` (KiB on macOS and Linux), run without a shell. Where `ps` is missing
 * (a minimal Linux), every probe answers null: the watchdog is then a no-op and the timeout
 * alone bounds the run.
 */
export const psRss: RssProbe = (pid) =>
  new Promise((resolve) => {
    execFile('ps', ['-o', 'rss=', '-p', String(pid)], { windowsHide: true }, (err, stdout) => {
      const kib = Number.parseInt(String(stdout).trim(), 10)
      resolve(err || !Number.isFinite(kib) ? null : kib * 1024)
    })
  })

const fail = (items: readonly unknown[], error: string): MathResult[] =>
  items.map(() => ({ ok: false, error }))

/**
 * Typst's first `error:` line without the prefix (the message, not the source excerpt), with
 * the run's temp dir (`dirs`: as given and as resolved, /var vs /private/var on macOS) cut from
 * paths: the tooltip shows `formulas.json`, not a random folder of the user's temp dir. A mitex
 * error arrives wrapped by Typst's plugin call (`plugin errored with: error: unknown command:
 * \ce`); only mitex's own message is kept, as the tooltip's reason.
 */
export function firstError(
  stderr: string,
  code: number | null,
  dirs: readonly string[] = [],
): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const line = lines.find((l) => l.startsWith('error:')) ?? lines.at(-1)
  if (!line) return `Typst endete mit Code ${code}.`
  let message = line.replace(/^error:\s*/, '').replace(/^plugin errored with:\s*(?:error:\s*)?/, '')
  // Longest first: the resolved path may contain the given one as a suffix.
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
    if (!dir) continue
    message = message.split(`${dir}/`).join('').split(`${dir}\\`).join('').split(dir).join('')
  }
  return message
}

/**
 * A Typst failure located in a formula: an excerpt from main.typ or mitex (a mitex error such as
 * `unknown command: \ce` points into mitex/mitex.typ), or the marker.
 */
const inFormula = (stderr: string): boolean =>
  stderr.includes(MATH_REFUSED) || /┌─\s*(?:main\.typ|mitex[\\/])/.test(stderr)

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
  /** The bundled pipeline folder (bin/typst, fonts/, vendor/mitex), as the export uses it. */
  private readonly root: string
  private readonly timeoutMs: number
  private readonly deadlineMs: number
  private readonly spawnImpl: typeof spawn
  private readonly rssProbe: RssProbe | null
  private readonly maxRssBytes: number
  private readonly maxSvgBytes: number
  private queue: Promise<unknown> = Promise.resolve()
  /** Bumped by dispose(): runs queued or running under an older generation are abandoned. */
  private generation = 0
  private running: ChildProcess | null = null

  // A plain field, no parameter property: pipeline/tests/test-math.sh runs this class under
  // Node's type stripping, which only erases types.
  constructor(
    root: string,
    opts: {
      timeoutMs?: number
      deadlineMs?: number
      spawnImpl?: typeof spawn
      /** Memory watchdog probe; null: none (default: `ps`, except on Windows). */
      rssProbe?: RssProbe | null
      maxRssBytes?: number
      maxSvgBytes?: number
    } = {},
  ) {
    this.root = root
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS
    this.spawnImpl = opts.spawnImpl ?? spawn
    // Windows has no `ps`; a runaway formula there is stopped by the timeout alone (10 s of
    // allocation is bounded by the machine, and Typst gets killed with its tree).
    this.rssProbe =
      opts.rssProbe !== undefined ? opts.rssProbe : process.platform === 'win32' ? null : psRss
    this.maxRssBytes = opts.maxRssBytes ?? DEFAULT_MAX_RSS_BYTES
    this.maxSvgBytes = opts.maxSvgBytes ?? DEFAULT_MAX_SVG_BYTES
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
      runsTypstCode(item.tex) ? { ok: false, error: TYPST_CODE } : undefined,
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
      // mitex inside the root (the program imports "mitex/mitex.typ"); symlinks are skipped so
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
      // Both spellings of the temp dir, to cut it from Typst's messages.
      const dirs = [dir, await realpath(dir).catch(() => dir)]
      const deadline = Date.now() + this.deadlineMs
      /** The whole batch's error, while its first single item has not run. */
      let batchError: string | null = null
      /** Set when every run fails the same way, not because of a formula. */
      let systemic: string | null = null
      const solve = async (part: typeof todo): Promise<void> => {
        const set = (error: string) => {
          for (const { i } of part) results[i] = { ok: false, error }
        }
        if (generation !== this.generation) return set(ABORTED)
        if (systemic !== null) return set(systemic)
        const left = deadline - Date.now()
        if (left <= 0) return set(TIMEOUT)
        const timeout = Math.min(this.timeoutMs, left)
        const res = await this.compile(
          bin,
          dir,
          part.map((p) => p.item),
          timeout,
          generation,
          dirs,
        )
        if (generation !== this.generation) return set(ABORTED)
        // The whole batch's error, if this is the first single item since it failed.
        const firstSingle = part.length === 1 ? batchError : null
        if (part.length === 1) batchError = null
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
        if (part === todo && part.length > 1 && !res.formula) batchError = res.error
        if (part.length === 1) {
          // The first single item failing like the whole batch, with no formula to blame (Typst
          // does not start, crashes on load): every further run would too, so stop halving.
          if (firstSingle !== null && !res.formula && res.error === firstSingle)
            systemic = res.error
          return set(res.error)
        }
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
    dirs: readonly string[] = [dir],
  ): Promise<Compiled> {
    for (const f of await readdir(dir)) if (/^out-\d+\.svg$/.test(f)) await rm(join(dir, f))
    await writeFile(join(dir, 'formulas.json'), JSON.stringify(items))
    // A dispose() while the temp dir was being prepared: never start Typst for it.
    if (generation !== this.generation) return { ok: false, error: ABORTED, formula: true }
    // null: Typst finished without an error and wrote the pages.
    const failed = await new Promise<Compiled | null>((resolve) => {
      let stderr = ''
      let settled = false
      /** Why the run was killed (timeout, memory), given once it has exited. */
      let killed: Compiled | null = null
      let watchdog: ReturnType<typeof setInterval> | undefined
      const finish = (v: Compiled | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearInterval(watchdog)
        this.running = null
        resolve(v)
      }
      const kill = (why: string) => {
        if (killed || settled) return
        // A runaway formula, not a broken setup: halving isolates it.
        const result: Compiled = { ok: false, error: why, formula: true }
        killed = result
        killTree(child)
        // Wait for the exit so the next run never overlaps the killed one; bounded by the grace.
        setTimeout(() => finish(result), CLOSE_GRACE_MS).unref()
      }
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
      const timer = setTimeout(() => kill(TIMEOUT), timeoutMs)
      // Memory: a formula can make Typst allocate without bound (a loop through a mitex
      // passthrough the checks missed); the timeout alone would let it take gigabytes first.
      const probe = this.rssProbe
      const pid = child.pid
      if (probe && pid !== undefined) {
        let asking = false
        watchdog = setInterval(() => {
          if (asking) return
          asking = true
          void probe(pid)
            .catch(() => null)
            .then((rss) => {
              asking = false
              if (rss !== null && rss > this.maxRssBytes) kill(TOO_MUCH_MEMORY)
            })
        }, RSS_POLL_MS)
        watchdog.unref?.()
      }
      child.stderr?.setEncoding('utf8').on('data', (d: string) => {
        if (stderr.length < MAX_STDERR) stderr += d
      })
      child.on('error', (err: NodeJS.ErrnoException) =>
        finish({
          ok: false,
          error: err.code === 'ENOENT' ? MISSING : err.message,
          formula: false,
        }),
      )
      child.on('close', (c) => {
        if (killed) finish(killed)
        else if (c === 0) finish(null)
        else finish({ ok: false, error: this.message(stderr, c, dirs), formula: inFormula(stderr) })
      })
    })
    if (failed) return failed
    // `{0p}` pads page numbers to the page count's digits (out-01 … out-10): sort numerically.
    const files = (await readdir(dir))
      .map((f) => /^out-(\d+)\.svg$/.exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => Number(a[1]) - Number(b[1]))
    // Size first: a formula can draw a huge SVG (deep repetition), which would cost main and
    // the renderer memory to read, send and sanitise.
    let total = 0
    for (const m of files) total += (await stat(join(dir, m[0]))).size
    if (total > this.maxSvgBytes) return { ok: false, error: TOO_LARGE, formula: true }
    const pages = await Promise.all(files.map((m) => readFile(join(dir, m[0]), 'utf8')))
    return { ok: true, pages }
  }

  /** The message of a failed run: the refusal for MATH_PROGRAM's marker, else Typst's error. */
  private message(stderr: string, code: number | null, dirs: readonly string[]): string {
    return stderr.includes(MATH_REFUSED) ? TYPST_CODE : firstError(stderr, code, dirs)
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

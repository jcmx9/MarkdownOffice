/**
 * Formulas for Preview and Present as the PDF sets them: each formula first goes through the
 * bundled mitex (`convert_math`, the same wasm the set's Typst runs), so one the PDF cannot build
 * is flagged with mitex's message and never reaches Typst; the rest go to main in batches
 * (`mdo.renderMath`, one Typst run per batch, src/main/math.ts) and come back as SVG that the
 * sanitiser rebuilds (diagram-svg.ts).
 *
 * One service per window, shared by every tab, with no editor in it: the editor glue asks
 * `get()` for an entry, `request()`s the pending ones it shows and redraws on `onUpdate`
 * (dispatching {@link mathRefresh}). Results are cached by (kind, formula), so typing elsewhere
 * never sets a formula again. mitex is loaded on the first batch and kept.
 */
import { StateEffect } from '@codemirror/state'
import { MATH_MAX_ITEMS, MATH_MAX_TEX, type MathItem, type MathResult } from '../../core/math'
import { loadTypstPlugin, type TypstPlugin, TypstPluginError } from '../../core/typst-plugin'
import { sanitizeMathSvg } from './diagram-svg'

/** Message of every formula of a batch main could not answer (IPC or process failure). */
export const MATH_FAILED = 'Formeln konnten nicht gesetzt werden'
/** Message of a formula main would refuse for its length (it would reject the whole batch). */
export const MATH_TOO_LONG = 'Formel zu lang für die Vorschau'
/** Message of a formula whose SVG the sanitiser rejected. */
export const MATH_UNSHOWABLE = 'Formel nicht darstellbar'

/** Redraws the formulas (dispatched by the editor glue when entries change). */
export const mathRefresh = StateEffect.define<null>()

/** Cached results; well above MATH_MAX_ITEMS, and each is a few kB of DOM. */
const CACHE_SIZE = 1000

/** Collects a typing burst into one batch: one Typst run costs ~0.3 s, mostly process start. */
const DEBOUNCE_MS = 150

export type MathEntry =
  | { state: 'pending' }
  | { state: 'error'; message: string }
  | {
      state: 'ok'
      /** The sanitised SVG (never attached; widgets show clones via reprefix()). */
      svg: SVGSVGElement
      /** The id prefix the sanitiser gave `svg`. */
      prefix: string
      /** In em of the surrounding text (see MathResult). */
      width: number
      height: number
      depth: number
    }

type Settled = Exclude<MathEntry, { state: 'pending' }>

export interface MathServiceOptions {
  /** Instantiates mitex (default: the pipeline's wasm over IPC). */
  loadMitex?: () => Promise<TypstPlugin>
  /** Sets a batch with Typst (default: `mdo.renderMath`). */
  render?: (items: MathItem[]) => Promise<MathResult[]>
  debounceMs?: number
  warn?: (message: string) => void
}

export interface MathService {
  /** The entry for `item`; 'pending' until a requested render has settled it. */
  get(item: MathItem): MathEntry
  /** Schedules rendering for the items without a result (deduplicated, debounced). */
  request(items: MathItem[]): void
  /** Called after entries changed; returns the unsubscribe function. */
  onUpdate(cb: () => void): () => void
}

const keyOf = (item: MathItem): string => `${item.display ? 'D' : 'I'}:${item.tex}`

/** Id prefixes `mdo-mx<n>`, one per sanitised formula (widgets move clones to their own). */
let prefixes = 0
const nextPrefix = (): string => `mdo-mx${++prefixes}`

const encoder = new TextEncoder()
/** mitex's spec argument; empty = its built-in LaTeX spec, as vendor/mitex/mitex.typ passes. */
const NO_SPEC = new Uint8Array()

/** mitex prefixes its messages with "error: "; the tooltip shows the message alone. */
const mitexMessage = (message: string): string => message.replace(/^error:\s*/, '')

export function createMathService(options: MathServiceOptions = {}): MathService {
  const loadMitex =
    options.loadMitex ?? (async () => loadTypstPlugin(await window.mdo.pluginWasm('mitex')))
  const render = options.render ?? ((items: MathItem[]) => window.mdo.renderMath(items))
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS
  const warn = options.warn ?? ((message: string) => console.warn(message))

  const cache = new Map<string, Settled>()
  /** Generation of the batch whose result a key holds; an older batch never overwrites it. */
  const settledBy = new Map<string, number>()
  const queue = new Map<string, MathItem>()
  const listeners = new Set<() => void>()
  const warned = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let generation = 0

  let mitex: TypstPlugin | null = null
  let mitexFailed = false

  function warnOnce(message: string): void {
    if (warned.has(message)) return
    warned.add(message)
    warn(message)
  }

  function notify(): void {
    for (const cb of Array.from(listeners)) cb()
  }

  /** Stores `entry` for `key` unless a newer batch already did (true when stored). */
  function store(key: string, gen: number, entry: Settled): boolean {
    if ((settledBy.get(key) ?? 0) > gen) return false
    settledBy.set(key, gen)
    cache.delete(key)
    cache.set(key, entry)
    if (cache.size > CACHE_SIZE) {
      const oldest = cache.keys().next().value as string
      cache.delete(oldest)
      settledBy.delete(oldest)
    }
    return true
  }

  /** mitex's verdict: its error message, or null when it converts (or cannot be asked). */
  async function precheck(tex: string): Promise<string | null> {
    if (!mitex && !mitexFailed) {
      try {
        mitex = await loadMitex()
      } catch (e) {
        // No retry: the file is missing or broken for this whole session. Typst still sets the
        // formula (with the same mitex), so an error then comes from main instead.
        mitexFailed = true
        warnOnce(`Markdown Office: Formelprüfung nicht verfügbar: ${String(e)}`)
      }
    }
    if (!mitex) return null
    try {
      mitex.call('convert_math', encoder.encode(tex), NO_SPEC)
      return null
    } catch (e) {
      if (e instanceof TypstPluginError) return mitexMessage(e.message)
      // A trap may leave the instance's memory broken: the next formula loads a fresh one.
      mitex = null
      warnOnce(`Markdown Office: Formelprüfung abgestürzt: ${String(e)}`)
      return null
    }
  }

  function toEntry(result: MathResult | undefined): Settled {
    if (!result) return { state: 'error', message: MATH_FAILED }
    if (!result.ok) return { state: 'error', message: result.error }
    const prefix = nextPrefix()
    let svg: SVGSVGElement | null = null
    try {
      svg = sanitizeMathSvg(result.svg, prefix, document)
    } catch (e) {
      // Pathological output (deep nesting) can exhaust the stack.
      warnOnce(`Markdown Office: ${MATH_UNSHOWABLE}: ${String(e)}`)
    }
    if (!svg) return { state: 'error', message: MATH_UNSHOWABLE }
    const { width, height, depth } = result
    return { state: 'ok', svg, prefix, width, height, depth }
  }

  async function renderBatch(items: MathItem[], gen: number): Promise<void> {
    let results: MathResult[]
    try {
      results = await render(items)
    } catch {
      // Main never rejects a valid batch, so this is IPC or the app going away: flag the batch
      // (cached, no retry loop) and say so once per window.
      results = items.map(() => ({ ok: false, error: MATH_FAILED }))
      warnOnce(MATH_FAILED)
    }
    let changed = false
    items.forEach((item, i) => {
      if (store(keyOf(item), gen, toEntry(results[i]))) changed = true
    })
    if (changed) notify()
  }

  async function flush(): Promise<void> {
    timer = null
    // A newer batch may overlap a key still in flight here: whichever settles, the result of
    // the newer generation is the one kept (an older failure never hides a newer success).
    const gen = ++generation
    const items = Array.from(queue.values())
    queue.clear()
    const send: MathItem[] = []
    let flagged = false
    for (const item of items) {
      if (item.tex.length > MATH_MAX_TEX) {
        flagged = store(keyOf(item), gen, { state: 'error', message: MATH_TOO_LONG }) || flagged
        continue
      }
      const error = await precheck(item.tex)
      if (error === null) send.push(item)
      else flagged = store(keyOf(item), gen, { state: 'error', message: error }) || flagged
    }
    if (flagged) notify()
    const batches: Promise<void>[] = []
    for (let i = 0; i < send.length; i += MATH_MAX_ITEMS) {
      batches.push(renderBatch(send.slice(i, i + MATH_MAX_ITEMS), gen))
    }
    await Promise.all(batches)
  }

  return {
    get(item) {
      const key = keyOf(item)
      const hit = cache.get(key)
      if (!hit) return { state: 'pending' }
      // LRU by Map order.
      cache.delete(key)
      cache.set(key, hit)
      return hit
    },
    request(items) {
      for (const item of items) {
        const key = keyOf(item)
        if (cache.has(key) || queue.has(key)) continue
        // Fresh plain objects: exactly what main's validation accepts.
        queue.set(key, { tex: item.tex, display: item.display })
      }
      // A fixed window from the first request, so steady typing cannot postpone the batch.
      if (queue.size > 0 && timer === null) {
        timer = setTimeout(() => void flush(), debounceMs)
      }
    },
    onUpdate(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}

/** The window's formulas: one mitex instance and one cache for every tab. */
export const mathService = createMathService()

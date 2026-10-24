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

/**
 * Cached results; well above MATH_MAX_ITEMS, and each is a few kB of DOM. Formulas in use (see
 * `inUse`) are never evicted, so a note with more distinct formulas grows the cache past this.
 */
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
  /** Told MATH_FAILED, once per service (diagnostics go to the console). */
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
  /**
   * Keys requested and not settled yet: queued, in the pre-check or in flight. A formula's result
   * depends on its key alone, so a pending key is never sent again (no duplicate Typst runs while
   * the first render of a newly shown formula takes its ~0.3 s).
   */
  const pending = new Set<string>()
  const queue = new Map<string, MathItem>()
  const listeners = new Set<() => void>()
  const diagnosed = new Set<string>()
  /**
   * Keys asked for in the current round and the one before. A round is one synchronous burst of
   * get()/request() calls, i.e. one editor build, which asks for every shown formula. Evicting
   * one of these would make the next build ask for it again, its render evict another, and so on
   * for ever (a note with more distinct formulas than CACHE_SIZE); the previous round covers
   * the results that arrive between two builds.
   */
  let round = new Set<string>()
  let lastRound = new Set<string>()
  let roundOpen = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let failureWarned = false

  /** The mitex load in progress or done (shared by overlapping batches); null: load anew. */
  let mitexLoading: Promise<TypstPlugin | null> | null = null
  let mitexFailed = false

  /** Developer diagnostics (console, once each); the injected `warn` is for MATH_FAILED only. */
  function diagnose(reason: string, detail: unknown): void {
    if (diagnosed.has(reason)) return
    diagnosed.add(reason)
    console.warn(`Markdown Office: ${reason}: ${String(detail)}`)
  }

  function notify(): void {
    for (const cb of Array.from(listeners)) cb()
  }

  function touch(key: string): void {
    if (!roundOpen) {
      roundOpen = true
      queueMicrotask(() => {
        lastRound = round
        round = new Set()
        roundOpen = false
      })
    }
    round.add(key)
  }

  function store(key: string, entry: Settled): void {
    pending.delete(key)
    cache.delete(key)
    cache.set(key, entry)
  }

  /** LRU eviction down to CACHE_SIZE, skipping the formulas in use. */
  function trim(): void {
    if (cache.size <= CACHE_SIZE) return
    for (const key of cache.keys()) {
      if (cache.size <= CACHE_SIZE) break
      if (!round.has(key) && !lastRound.has(key)) cache.delete(key)
    }
  }

  function getMitex(): Promise<TypstPlugin | null> {
    if (mitexFailed) return Promise.resolve(null)
    mitexLoading ??= loadMitex().catch((e: unknown) => {
      // No retry: the file is missing or broken for this whole session. Typst still sets the
      // formula (with the same mitex), so an error then comes from main instead.
      mitexFailed = true
      diagnose('Formelprüfung nicht verfügbar', e)
      return null
    })
    return mitexLoading
  }

  /** mitex's verdict: its error message, or null when it converts (or cannot be asked). */
  async function precheck(tex: string): Promise<string | null> {
    const loading = getMitex()
    const mitex = await loading
    if (!mitex) return null
    try {
      mitex.call('convert_math', encoder.encode(tex), NO_SPEC)
      return null
    } catch (e) {
      if (e instanceof TypstPluginError) return mitexMessage(e.message)
      // A trap may leave the instance's memory broken: the next formula loads a fresh one
      // (unless another batch already started that reload).
      if (mitexLoading === loading) mitexLoading = null
      diagnose('Formelprüfung abgestürzt', e)
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
      diagnose(MATH_UNSHOWABLE, e)
    }
    if (!svg) return { state: 'error', message: MATH_UNSHOWABLE }
    const { width, height, depth } = result
    return { state: 'ok', svg, prefix, width, height, depth }
  }

  async function renderBatch(items: MathItem[]): Promise<void> {
    let results: MathResult[]
    try {
      results = await render(items)
    } catch {
      // Main never rejects a valid batch, so this is IPC or the app going away: flag the batch
      // (cached, no retry loop) and say so once per window.
      results = items.map(() => ({ ok: false, error: MATH_FAILED }))
      if (!failureWarned) {
        failureWarned = true
        warn(MATH_FAILED)
      }
    }
    items.forEach((item, i) => {
      store(keyOf(item), toEntry(results[i]))
    })
    trim()
    notify()
  }

  async function flush(): Promise<void> {
    timer = null
    // The keys stay in `pending` through the awaits below, so a request meanwhile skips them.
    const items = Array.from(queue.values())
    queue.clear()
    const send: MathItem[] = []
    let flagged = false
    for (const item of items) {
      if (item.tex.length > MATH_MAX_TEX) {
        store(keyOf(item), { state: 'error', message: MATH_TOO_LONG })
        flagged = true
        continue
      }
      const error = await precheck(item.tex)
      if (error === null) {
        send.push(item)
      } else {
        store(keyOf(item), { state: 'error', message: error })
        flagged = true
      }
    }
    if (flagged) {
      trim()
      notify()
    }
    const batches: Promise<void>[] = []
    for (let i = 0; i < send.length; i += MATH_MAX_ITEMS) {
      batches.push(renderBatch(send.slice(i, i + MATH_MAX_ITEMS)))
    }
    await Promise.all(batches)
  }

  return {
    get(item) {
      const key = keyOf(item)
      touch(key)
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
        touch(key)
        if (cache.has(key) || pending.has(key)) continue
        pending.add(key)
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

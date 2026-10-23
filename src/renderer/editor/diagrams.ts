/**
 * Mermaid diagrams in Preview and Present, drawn as the PDF draws them: a fenced ```mermaid
 * block whose lines no selection touches is replaced by the SVG of the bundled mmdr plugin
 * (src/core/mermaid.ts, same wasm and arguments as the set's .typ), rebuilt by the sanitiser
 * (diagram-svg.ts) and fitted by memo.typ's rule. The Code view, the block with the cursor and
 * every failure show the source; the note's bytes never change.
 *
 * The plugin is loaded on the first shown diagram per window and kept; results are cached by
 * (set options, source), so typing elsewhere never draws a diagram again. Until the plugin is
 * there a block stays source and the view plugin redraws once it has loaded.
 */
import { syntaxTree } from '@codemirror/language'
import {
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { type MermaidOptions, renderMermaid } from '../../core/mermaid'
import { MEMO_PREVIEW } from '../../core/preview-spec'
import { loadTypstPlugin, type TypstPlugin, TypstPluginError } from '../../core/typst-plugin'
import { sanitizeDiagramSvg } from './diagram-svg'
import { previewSource } from './preview-source'
import { previewView, selectionTouches } from './rendered'

/** Notice under a block whose diagram failed (load error, plugin error, rejected SVG). */
export const DIAGRAM_FAILED = 'Diagramm konnte nicht gezeichnet werden'
/** Notice under a drawing with nothing in it (a type mmdr cannot draw, e.g. zenuml). */
export const DIAGRAM_EMPTY = 'Diagramm nicht darstellbar'

/** Redraws the diagrams (dispatched once the plugin has loaded). */
export const diagramsRefresh = StateEffect.define<null>()

/** Cached results; a note rarely has more, and each is a few kB of DOM. */
const CACHE_SIZE = 200

/** Why a diagram is not shown; each reason is warned about once per window. */
type Reason = 'load' | 'error' | 'crash' | 'sanitize'

type Entry =
  | {
      ok: true
      key: string
      /** The sanitised SVG (never attached; widgets show clones). */
      svg: SVGSVGElement
      width: number
      height: number
      /** Valid, but nothing drawn besides the background. */
      empty: boolean
    }
  | { ok: false; key: string }

export interface DiagramsOptions {
  /** Instantiates mmdr (default: the pipeline's wasm over IPC). */
  load?: () => Promise<TypstPlugin>
  warn?: (message: string) => void
  /** The SVG sanitiser (tests inject failures). */
  sanitize?: typeof sanitizeDiagramSvg
}

interface DiagramsValue {
  deco: DecorationSet
  /** A shown block waits for the plugin to load. */
  pending: boolean
}

const LENGTH_RE = /^(\d+(?:\.\d+)?)(mm|cm|pt|in)$/
const PX_PER: Record<string, number> = { mm: 96 / 25.4, cm: 96 / 2.54, pt: 96 / 72, in: 96 }

/** A set's `max-height` (Typst length in mm/cm/pt/in) in CSS px at zoom 1, or null. */
export function lengthToPx(length: string): number | null {
  const m = LENGTH_RE.exec(length.trim())
  if (!m?.[1] || !m[2]) return null
  return Number(m[1]) * (PX_PER[m[2]] ?? 0)
}

/**
 * The shown width in px, by memo.typ's rule `natural × min(1, width / natural.width,
 * max-height / natural.height)`. Typst measures an SVG's user units as CSS px (100 units are
 * 75pt), so the natural size and the print length max-height scale with the zoom like all
 * print units here; the text width is measured, so it already does.
 */
export function fitDiagramWidth(
  natural: { width: number; height: number },
  textWidth: number,
  maxHeightPx: number,
  scale: number,
): number {
  const width = natural.width * scale
  const height = natural.height * scale
  if (!(width > 0) || !(height > 0)) return width > 0 ? width : 0
  const byWidth = textWidth > 0 ? textWidth / width : 1
  const byHeight = maxHeightPx > 0 ? (maxHeightPx * scale) / height : 1
  return width * Math.min(1, byWidth, byHeight)
}

const DRAWABLE = 'path, rect, circle, ellipse, line, polyline, polygon, text'

/**
 * True when the drawing holds nothing but mmdr's background (a rect over the whole viewBox)
 * and marker definitions: what mmdr returns for a source it cannot lay out.
 */
function drawsNothing(svg: SVGSVGElement): boolean {
  const box = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const num = (el: Element, name: string) => Number(el.getAttribute(name) ?? 0)
  for (const el of Array.from(svg.querySelectorAll(DRAWABLE))) {
    if (el.closest('defs, marker')) continue
    const background =
      el.parentNode === svg &&
      el.localName === 'rect' &&
      box.length === 4 &&
      ['x', 'y', 'width', 'height'].every((name, i) => num(el, name) === box[i])
    if (!background) return false
  }
  return true
}

/**
 * The text Typst's `it.text` holds for the block: the lines between the fences (an unclosed
 * fence runs to the end), the fence's indentation removed as CommonMark does, `\n` line ends
 * (a mixed-EOL note keeps `\r` in its lines) and no trailing newline.
 */
function blockText(
  state: EditorState,
  node: { from: number; to: number; lastChild: { name: string; from: number } | null },
) {
  const doc = state.doc
  const open = doc.lineAt(node.from)
  const last = doc.lineAt(Math.max(node.from, node.to - 1))
  const closed =
    node.lastChild?.name === 'CodeMark' &&
    node.lastChild.from > open.to &&
    last.number > open.number
  const indent = node.from - open.from
  const lines: string[] = []
  for (let n = open.number + 1; n <= (closed ? last.number - 1 : last.number); n++) {
    let text = doc.line(n).text
    if (text.endsWith('\r')) text = text.slice(0, -1)
    let strip = 0
    while (strip < indent && text[strip] === ' ') strip++
    lines.push(text.slice(strip))
  }
  return { from: open.from, to: last.to, text: lines.join('\n') }
}

/** Per widget DOM: disconnects its observers. */
const fitters = new WeakMap<HTMLElement, () => void>()

class DiagramWidget extends WidgetType {
  constructor(
    readonly entry: Extract<Entry, { ok: true }>,
    readonly maxHeightPx: number,
  ) {
    super()
  }
  override eq(other: DiagramWidget): boolean {
    return other.entry.key === this.entry.key
  }
  override get estimatedHeight(): number {
    // Zoom 1 and the 1.4em spacing at 10pt; the measure corrects it once shown.
    return Math.min(this.entry.height, this.maxHeightPx || this.entry.height) + 2 * 18.7
  }
  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'mdo-diagram'
    // A clone of the sanitised tree: DOM nodes only, never markup.
    const svg = this.entry.svg.cloneNode(true) as SVGSVGElement
    wrap.append(svg)
    if (this.entry.empty) wrap.append(notice(DIAGRAM_EMPTY))
    wrap.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      // Into the block: the field then shows the source for editing (like the table widget).
      view.dispatch({ selection: { anchor: view.posAtDOM(wrap) } })
      view.focus()
    })
    // Unit tests pass a stub view, and happy-dom may lack ResizeObserver: no fitting there.
    if (typeof view.requestMeasure === 'function' && typeof ResizeObserver === 'function') {
      const fit = () => this.fit(view, wrap, svg)
      // The wrap's width follows window, zoom and Present's column.
      const ro = new ResizeObserver(fit)
      ro.observe(wrap)
      // The zoom factor alone (on #editor) changes the natural size without resizing the wrap
      // when the window is narrower than the text width.
      const mo = new MutationObserver(fit)
      const host = view.dom.parentElement
      if (host) mo.observe(host, { attributes: true, attributeFilter: ['style'] })
      fitters.set(wrap, () => {
        ro.disconnect()
        mo.disconnect()
      })
    }
    return wrap
  }
  /** Sets the SVG's width to the fitted px in CodeMirror's measure cycle (height via viewBox). */
  private fit(view: EditorView, wrap: HTMLElement, svg: SVGSVGElement): void {
    view.requestMeasure({
      key: wrap,
      read: () => {
        if (!wrap.isConnected) return null
        const s = getComputedStyle(wrap)
        const textWidth =
          wrap.clientWidth - Number.parseFloat(s.paddingLeft) - Number.parseFloat(s.paddingRight)
        const scale =
          Number.parseFloat(getComputedStyle(view.dom).getPropertyValue('--mdo-scale')) || 1
        return fitDiagramWidth(this.entry, textWidth, this.maxHeightPx, scale)
      },
      write: (width) => {
        if (width === null || !(width > 0)) return
        const value = String(Math.round(width * 1000) / 1000)
        if (svg.getAttribute('width') !== value) svg.setAttribute('width', value)
        svg.removeAttribute('height')
      },
    })
  }
  override destroy(dom: HTMLElement): void {
    fitters.get(dom)?.()
    fitters.delete(dom)
  }
  override ignoreEvent(): boolean {
    return true
  }
}

function notice(text: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'mdo-diagram-notice'
  el.textContent = text
  return el
}

class NoticeWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  override eq(other: NoticeWidget): boolean {
    return other.text === this.text
  }
  override toDOM(): HTMLElement {
    return notice(this.text)
  }
}

/**
 * A diagram field with its own plugin and cache. The app uses one per window ({@link diagrams}),
 * shared by all tabs, so switching tabs finds the drawings already made.
 */
export function createDiagrams(options: DiagramsOptions = {}) {
  const load = options.load ?? (async () => loadTypstPlugin(await window.mdo.pluginWasm('mmdr')))
  const warn = options.warn ?? ((message: string) => console.warn(message))
  const sanitize = options.sanitize ?? sanitizeDiagramSvg

  let plugin: TypstPlugin | null = null
  let loading: Promise<void> | null = null
  let loadFailed = false
  const cache = new Map<string, Entry>()
  const warned = new Set<Reason>()
  /** Gives every drawing its own id prefix, `mdo-dg<n>`, so markers never collide. */
  let drawn = 0

  function warnOnce(reason: Reason, detail: unknown): void {
    if (warned.has(reason)) return
    warned.add(reason)
    warn(`Markdown Office: ${DIAGRAM_FAILED} (${reason}): ${String(detail)}`)
  }

  function startLoad(): void {
    loading ??= load()
      .then(
        (p) => {
          plugin = p
        },
        (e: unknown) => {
          // No retry: the file is missing or broken for this whole session.
          loadFailed = true
          warnOnce('load', e)
        },
      )
      .finally(() => {
        loading = null
      })
  }

  function store(entry: Entry): Entry {
    cache.set(entry.key, entry)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string)
    return entry
  }

  /** The drawing for `source`, or 'pending' while the plugin loads. */
  function lookup(source: string, opts: MermaidOptions): Entry | 'pending' {
    const key = `${JSON.stringify(opts)}\n${source}`
    const hit = cache.get(key)
    if (hit) {
      // LRU by Map order.
      cache.delete(key)
      cache.set(key, hit)
      return hit
    }
    if (loadFailed) return { ok: false, key }
    if (!plugin) {
      startLoad()
      return 'pending'
    }
    let raw: string
    try {
      raw = renderMermaid(plugin, source, opts)
    } catch (e) {
      if (e instanceof TypstPluginError) {
        warnOnce('error', e.message)
      } else {
        // A trap may leave the instance's memory broken: the next diagram loads a fresh one.
        plugin = null
        warnOnce('crash', e)
      }
      return store({ ok: false, key })
    }
    let svg: SVGSVGElement | null = null
    try {
      svg = sanitize(raw, `mdo-dg${++drawn}`, document)
    } catch (e) {
      // Pathological input (deep nesting) can exhaust the stack.
      warnOnce('sanitize', e)
      return store({ ok: false, key })
    }
    if (!svg) {
      warnOnce('sanitize', 'not a drawable SVG')
      return store({ ok: false, key })
    }
    const width = Number(svg.getAttribute('width'))
    const height = Number(svg.getAttribute('height'))
    return store({ ok: true, key, svg, width, height, empty: drawsNothing(svg) })
  }

  function build(state: EditorState): DiagramsValue {
    const opts = (state.field(previewSource, false)?.spec ?? MEMO_PREVIEW).mermaid
    // No Preview, or a set whose .typ draws no diagrams: every block stays code.
    if (!state.facet(previewView) || !opts) return { deco: Decoration.none, pending: false }
    const maxHeightPx = lengthToPx(opts.maxHeight) ?? 0
    const out: Range<Decoration>[] = []
    let pending = false
    syntaxTree(state).iterate({
      enter: (n) => {
        // Top-level blocks only, like tables: inside lists and quotes the source stays.
        if (n.name === 'Document') return undefined
        if (n.name !== 'FencedCode') return false
        const info = n.node.getChild('CodeInfo')
        const lang = info ? state.doc.sliceString(info.from, info.to).trim().split(/\s+/)[0] : ''
        if (lang !== 'mermaid') return false
        const block = blockText(state, n.node)
        if (selectionTouches(state, block.from, block.to)) return false
        const entry = lookup(block.text, opts)
        if (entry === 'pending') {
          pending = true
        } else if (entry.ok) {
          out.push(
            Decoration.replace({
              widget: new DiagramWidget(entry, maxHeightPx),
              block: true,
              rf: 'diagram',
            }).range(block.from, block.to),
          )
        } else {
          out.push(
            Decoration.widget({
              widget: new NoticeWidget(DIAGRAM_FAILED),
              block: true,
              side: 1,
              rf: 'diagram-notice',
            }).range(block.to),
          )
        }
        return false
      },
    })
    return { deco: Decoration.set(out), pending }
  }

  const field = StateField.define<DiagramsValue>({
    create: build,
    update(value, tr) {
      const rebuild =
        tr.docChanged ||
        tr.selection !== undefined ||
        tr.reconfigured ||
        syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
        tr.startState.field(previewSource, false) !== tr.state.field(previewSource, false) ||
        tr.effects.some((e) => e.is(diagramsRefresh))
      return rebuild ? build(tr.state) : value
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  })

  /** Redraws a view once the plugin it waits for has loaded (or failed to). */
  const waiter = ViewPlugin.fromClass(
    class {
      private waiting = false
      private destroyed = false
      constructor(readonly view: EditorView) {
        this.check(view.state)
      }
      update(u: ViewUpdate): void {
        this.check(u.state)
      }
      private check(state: EditorState): void {
        if (this.waiting || !state.field(field, false)?.pending) return
        this.waiting = true
        void ready().then(() => {
          this.waiting = false
          if (!this.destroyed) this.view.dispatch({ effects: diagramsRefresh.of(null) })
        })
      }
      destroy(): void {
        this.destroyed = true
      }
    },
  )

  /** Settles when no plugin load is running (resolved either way). */
  function ready(): Promise<void> {
    return loading ?? Promise.resolve()
  }

  const extension: Extension = [field, waiter]
  return { field, extension, ready }
}

/** The window's diagrams: one plugin and one cache for every tab. */
export const diagrams = createDiagrams()

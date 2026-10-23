/**
 * Rendered preview paragraphs set like the PDF: the browser no longer wraps them; the engine in
 * `src/core/paragraph/` (Typst 0.15.0's break opportunities, hyphenation and line breaking)
 * picks the breaks from measured widths, and this plugin shows them with display-only
 * decorations. The note's bytes never change.
 *
 * - Which lines: body paragraphs, list items, paragraphs in quotes and alerts, when the line is
 *   rendered (`lineIsRendered`: preview or Present, no selection touching it). The cursor's
 *   paragraph keeps the browser's wrapping (step 2), so it never jumps while typing.
 * - Measuring: the rendered line is cloned into a hidden copy of the editor's DOM scope (same
 *   classes, set scope, zoom) with `white-space: pre`, and every display character's x is read in
 *   one layout pass. Widget text (typographic quotes, dashes) is measured as rendered but never
 *   broken inside.
 * - Rendering: the line gets `mdo-par-set` (no browser wrapping, natural spaces, left aligned),
 *   each break a widget `<br>` (after a hyphen when hyphenated), each adjusted line a
 *   `word-spacing` mark. The trailing space of a line stays in the DOM before its break; the
 *   available width leaves room for it (see `domMeasurer`).
 * - Fallback: no layout (fonts loading, zero or NaN widths) or an engine error leaves the line to
 *   the browser (step 2). Real errors warn once per session and kind; a line that is not drawn
 *   yet or fonts still loading is expected and silent (retried on the next measure).
 */
import { syntaxTree } from '@codemirror/language'
import { type Extension, type Line, type Range, StateEffect } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { type BreakPoint, breakPoints } from '../../core/paragraph/breaks'
import type { Trie } from '../../core/paragraph/hyphenate'
import { type ParagraphInput, type SetLine, setParagraph } from '../../core/paragraph/linebreak'
import { frontmatterFields } from './frontmatter'
import { requestTrie, type TrieLang, trieFor } from './hyphenation-tries'
import { presentMode } from './mode'
import { type ParagraphSettings, paragraphSettings } from './paragraph-settings'
import { ALERT_RE, previewPlugin } from './preview'
import { previewSource } from './preview-source'
import { lineIsRendered } from './rendered'

/** One rendered line as the engine needs it, in display characters (what the reader sees). */
export interface Measured {
  /** The displayed characters of the line, widget text included. */
  text: string
  /** x[i] = left edge of display char i, x[text.length] = right edge of the line (px, unwrapped). */
  x: Float64Array
  /** Display index → doc offset; -1 inside a widget (its text is not in the note). */
  docPos: Int32Array
  /** Available width of visual line n, line 0 counted from display char 0. */
  lineWidth: (n: number) => number
  /** Width of '-' in the font of display char i. */
  hyphenWidth: (i: number) => number
  /** Font size in px at display char i. */
  fontSize: (i: number) => number
}

/**
 * Where the widths come from: the DOM in the app, fixed advances in unit tests (happy-dom has
 * no layout). `begin`/`end` let the DOM measurer lay out all lines of a pass at once.
 */
export interface LineMeasurer {
  measure(view: EditorView, line: Line): Measured | null
  begin?(view: EditorView, lines: readonly Line[]): void
  end?(): void
}

export interface ParagraphsOptions {
  measurer?: LineMeasurer
  /** The engine; tests count its calls. */
  setParagraph?: (p: ParagraphInput) => SetLine[]
  /** The set's paragraph tokens and the note's `lang`. */
  settings?: (view: EditorView, frontmatterLang: string | undefined) => ParagraphSettings
  warn?: (message: string, kind: FailureKind) => void
  /** Where the hyphenation tries come from (tests inject a failing loader). */
  tries?: {
    trieFor: (lang: TrieLang) => Trie | undefined
    requestTrie: (lang: TrieLang) => Promise<Trie>
  }
  /** Clock for the width hysteresis (ms). */
  now?: () => number
}

/**
 * Why a line was left to the browser. Only real errors are warned about; `transient` (line not
 * drawn, fonts loading, clone out of step) is the normal state at startup and while scrolling,
 * and retried on the next measure.
 */
export type FailureKind = 'measure' | 'widths' | 'engine' | 'trie'

/**
 * A `warn` that speaks once per kind: a fallback repeats for every line with the same reason,
 * but an engine error after, say, a broken width must still be heard.
 */
export function onceWarner(
  sink: (message: string) => void = console.warn,
): (m: string, kind: FailureKind) => void {
  const warned = new Set<FailureKind>()
  return (message, kind) => {
    if (warned.has(kind)) return
    warned.add(kind)
    sink(`paragraphs: ${message}; the line keeps the browser's wrapping`)
  }
}

// ── decorations ────────────────────────────────────────────────────────────────────────────

/**
 * A line break the engine chose, after a hyphen if it hyphenates there. Display only (the hyphen
 * is not in the note). Events are left to CodeMirror, so a click at a line end still places the
 * cursor (the paragraph then goes back to the browser's wrapping).
 */
class BreakWidget extends WidgetType {
  constructor(readonly hyphen: boolean) {
    super()
  }
  override eq(other: BreakWidget): boolean {
    return other.hyphen === this.hyphen
  }
  toDOM(): HTMLElement {
    const eol = document.createElement('span')
    eol.className = 'mdo-par-eol'
    if (this.hyphen) {
      const h = document.createElement('span')
      h.className = 'mdo-par-hyphen'
      h.textContent = '-'
      eol.append(h)
    }
    const br = document.createElement('br')
    br.className = 'mdo-par-break'
    eol.append(br)
    return eol
  }
  override ignoreEvent(): boolean {
    return false
  }
}

const setLineDeco = Decoration.line({ class: 'mdo-par-set', par: 'line' })
// side -1: the break sits before the next line's first character, after the trailing space.
const breakDeco = Decoration.widget({ widget: new BreakWidget(false), side: -1, par: 'break' })
const hyphenDeco = Decoration.widget({ widget: new BreakWidget(true), side: -1, par: 'hyphen' })
const adjustDecos = new Map<number, Decoration>()

/**
 * Typst adds the line's adjustment to every space; CSS `word-spacing` does exactly that. Typst
 * distributes it in proportion to each space's own width, so one value per visual line is exact
 * only when the line's spaces are equally wide (one font): accepted, a mixed line differs by
 * a fraction of a pixel per space.
 */
function adjustDeco(px: number): Decoration {
  let d = adjustDecos.get(px)
  if (!d) {
    // Values are rounded to 1/1000 px, but a long session can still meet many: bounded.
    if (adjustDecos.size >= 1000) adjustDecos.clear()
    d = Decoration.mark({
      class: 'mdo-par-adjust',
      attributes: { style: `word-spacing: ${px}px` },
      par: `adjust:${px}`,
    })
    adjustDecos.set(px, d)
  }
  return d
}

/** The engine's result in doc offsets relative to the line start (survives edits above). */
interface SetResult {
  breaks: Array<{ at: number; hyphen: boolean }>
  adjust: Array<{ from: number; to: number; px: number }>
}

interface Failure {
  reason: string
  /** null: transient, not warned and not remembered (retried on the next measure). */
  kind: FailureKind | null
}

function decorate(out: Range<Decoration>[], from: number, r: SetResult): void {
  out.push(setLineDeco.range(from))
  for (const b of r.breaks) out.push((b.hyphen ? hyphenDeco : breakDeco).range(from + b.at))
  for (const a of r.adjust) out.push(adjustDeco(a.px).range(from + a.from, from + a.to))
}

// ── which lines ────────────────────────────────────────────────────────────────────────────

/**
 * The doc offset where the paragraph text of `line` begins (after list and task markers, quote
 * marks and indentation), or null if the line is no paragraph: headings, tables, code, front
 * matter and HTML have their own nodes; an alert's marker line shows only its title widget.
 */
export function paragraphStart(view: EditorView, line: Line): number | null {
  const text = line.text
  const end = line.from + text.trimEnd().length
  if (end === line.from || ALERT_RE.test(text)) return null
  let node = syntaxTree(view.state).resolveInner(end, -1)
  while (node.name !== 'Paragraph' && node.name !== 'Task') {
    if (!node.parent) return null
    node = node.parent
  }
  let start = Math.max(line.from, node.from)
  const marker = node.name === 'Task' ? node.getChild('TaskMarker') : null
  if (marker && marker.to > start && marker.to <= end) start = marker.to
  while (start < end && /\s/.test(text.charAt(start - line.from))) start++
  return start < end ? start : null
}

interface Candidate {
  line: Line
  start: number
  key: string
  /** No-break spans of the line (doc offsets): set phrases and hidden-mark attachments. */
  nobreak: Array<{ from: number; to: number }>
}

/**
 * What a line's result depends on besides the environment: its text and the preview's
 * decorations on it (hidden marks, widgets, list indent, no-break spans), so a change of
 * typography language, link definitions or reveal state re-sets the line.
 */
function lineSignature(
  view: EditorView,
  line: Line,
): { sig: string; nobreak: Candidate['nobreak'] } {
  let sig = ''
  const nobreak: Candidate['nobreak'] = []
  view.plugin(previewPlugin)?.decorations.between(line.from, line.to, (from, to, d) => {
    const spec = d.spec as {
      rf?: string
      attributes?: { style?: string }
      widget?: { text?: unknown }
    }
    if (spec.rf === 'mark:mdo-nobreak') nobreak.push({ from, to })
    const widgetText = typeof spec.widget?.text === 'string' ? spec.widget.text : ''
    sig += `${from - line.from},${to - line.from},${spec.rf ?? ''},${spec.attributes?.style ?? ''},${widgetText};`
  })
  return { sig, nobreak }
}

// ── environment ────────────────────────────────────────────────────────────────────────────

interface Env {
  key: string
  /** The key without the content width (the width hysteresis compares the rest). */
  base: string
  width: number
  settings: ParagraphSettings
}

function readEnv(
  view: EditorView,
  fontGen: number,
  settingsOf: NonNullable<ParagraphsOptions['settings']>,
): Env {
  const settings = settingsOf(view, frontmatterFields(view.state.doc).lang)
  const style = getComputedStyle(view.dom)
  // Everything a set line's widths depend on besides its own text and decorations.
  const base = [
    view.dom.closest('[data-mdo-set]')?.getAttribute('data-mdo-set') ?? '',
    style.getPropertyValue('--mdo-scale').trim(),
    style.getPropertyValue('--mdo-space-advance').trim(),
    view.state.facet(presentMode),
    fontGen,
    JSON.stringify(settings),
  ].join('|')
  const width = view.contentDOM.clientWidth
  return { key: `${base}|${width}`, base, width, settings }
}

function hyphenLang(settings: ParagraphSettings): TrieLang | null {
  if (!settings.hyphenate) return null
  return settings.lang === 'de' || settings.lang === 'en' ? settings.lang : null
}

// ── setting one line ───────────────────────────────────────────────────────────────────────

const isSpaceChar = (c: string | undefined) => c !== undefined && /\s/.test(c)
const round = (px: number) => Math.round(px * 1000) / 1000

function setLine(
  view: EditorView,
  c: Candidate,
  env: Env,
  tries: Partial<Record<TrieLang, Trie>>,
  o: Required<ParagraphsOptions>,
): SetResult | Failure {
  let m: Measured | null
  try {
    m = o.measurer.measure(view, c.line)
  } catch (e) {
    return { reason: `measuring failed (${String(e)})`, kind: 'measure' }
  }
  // Not drawn, fonts loading, clone out of step: expected; the next measure tries again.
  if (!m) return { reason: 'no layout to measure', kind: null }
  const { docPos } = m
  const len = m.text.length

  // The paragraph's text: from the first char at its source start; widget text right before it
  // (an opening „ replacing the source quote) belongs to it, marker text (`1.`) does not.
  let start = docPos.findIndex((p) => p >= c.start)
  if (start < 0) return { breaks: [], adjust: [] }
  while (start > 0 && docPos[start - 1] === -1) start--
  while (start < len && isSpaceChar(m.text[start])) start++
  const text = m.text.slice(start)
  if (text === '') return { breaks: [], adjust: [] }
  const x = m.x.subarray(start)
  const x0 = m.x[0] ?? 0
  const first = m.lineWidth(0) - ((x[0] ?? 0) - x0)
  const rest = m.lineWidth(1)
  if (!x.every(Number.isFinite) || !((x[text.length] ?? 0) - (x[0] ?? 0) > 0)) {
    return { reason: 'zero or NaN character widths', kind: 'widths' }
  }
  if (!(first > 0) || !(rest > 0)) return { reason: 'zero or NaN line width', kind: 'widths' }

  // Doc offset where display char i starts; a widget's start is right after the char before it.
  const before = (i: number): number => {
    const p = docPos[i] ?? -1
    if (p >= 0) return p
    const q = docPos[i - 1] ?? -1
    return q >= 0 ? q + 1 : c.start
  }
  // Doc offset right after display char i - 1.
  const after = (i: number): number => {
    const p = docPos[i - 1] ?? -1
    if (p >= 0) return p + (/[\uD800-\uDBFF]/.test(m.text.charAt(i - 1)) ? 2 : 1)
    for (let k = i; k < len; k++) if ((docPos[k] ?? -1) >= 0) return docPos[k] as number
    return c.line.to
  }

  const lang = hyphenLang(env.settings)
  let lines: SetLine[]
  try {
    const breaks = breakPoints(text, {
      hyphenate: lang !== null,
      lang: env.settings.lang,
      tries,
    }).filter((b: BreakPoint) => {
      const i = b.index + start
      // Inside a widget's text (or between two widgets, which cannot be told apart).
      if (docPos[i] === -1 && docPos[i - 1] === -1) return false
      // Typst sees U+00A0 inside a no-break phrase (memo.typ's show rules): no break there.
      const d = before(i)
      return !c.nobreak.some((r) => r.from < d && d < r.to)
    })
    // Typst sets a paragraph at one font size (the em of its ratio and hyphen estimates).
    const size = m.fontSize(start)
    const measured = m
    lines = o.setParagraph({
      text,
      x,
      breaks,
      lineWidth: (n) => (n === 0 ? first : measured.lineWidth(n)),
      hyphenWidth: (i) => measured.hyphenWidth(i + start),
      justify: env.settings.justify,
      costs: env.settings.costs,
      fontSize: () => size,
    })
  } catch (e) {
    return {
      reason: `line breaking failed (${e instanceof Error ? e.message : String(e)})`,
      kind: 'engine',
    }
  }

  const from = c.line.from
  const out: SetResult = { breaks: [], adjust: [] }
  lines.forEach((l, k) => {
    if (k < lines.length - 1) out.breaks.push({ at: before(l.to + start) - from, hyphen: l.hyphen })
    // Shrinking can hit any line (also ragged and last ones when they overflow), so every
    // non-zero adjustment shows. The trailing space stays outside: it is not stretched.
    if (l.spaceAdjust === 0) return
    let e = l.to
    while (e > l.from && isSpaceChar(text[e - 1])) e--
    if (e <= l.from) return
    const a = before(l.from + start)
    const b = after(e + start)
    if (b > a) out.adjust.push({ from: a - from, to: b - from, px: round(l.spaceAdjust) })
  })
  return out
}

// ── the DOM measurer ───────────────────────────────────────────────────────────────────────

/** The `.cm-line` element drawing `line`, or null if the line is not in the DOM. */
export function lineElement(view: EditorView, line: Line): HTMLElement | null {
  let node: Node
  try {
    node = view.domAtPos(line.from).node
  } catch {
    return null
  }
  const el = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('.cm-line')
  if (!el || !view.contentDOM.contains(el)) return null
  return el as HTMLElement
}

const isWidgetRoot = (e: Element) =>
  e.getAttribute('contenteditable') === 'false' || (e as HTMLElement).contentEditable === 'false'

/** Text nodes of a line in order, without the break widgets this plugin drew. */
function textNodes(el: HTMLElement): Text[] {
  const out: Text[] = []
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement?.closest('.mdo-par-eol')) out.push(n as Text)
  }
  return out
}

function insideWidget(node: Node, line: HTMLElement): boolean {
  for (let e = node.parentElement; e && e !== line; e = e.parentElement) {
    if (isWidgetRoot(e)) return true
  }
  return false
}

export interface LineWalk {
  nodes: Text[]
  text: string
  docPos: Int32Array
}

/** The display text of a drawn line and where each char sits in the doc (-1: widget text). */
export function walkLine(view: EditorView, el: HTMLElement): LineWalk {
  const nodes = textNodes(el)
  let text = ''
  const pos: number[] = []
  for (const n of nodes) {
    const base = insideWidget(n, el) ? -1 : view.posAtDOM(n, 0)
    for (let k = 0; k < n.data.length; k++) pos.push(base < 0 ? -1 : base + k)
    text += n.data
  }
  return { nodes, text, docPos: Int32Array.from(pos) }
}

/**
 * The px CodeMirror's content keeps beyond the measure for the space before a break
 * (`--mdo-space-advance`, theme.css `.cm-content` max-width, fallback 0.2em there too).
 */
function spaceAdvancePx(view: EditorView): number {
  const cs = getComputedStyle(view.contentDOM)
  const fs = Number.parseFloat(cs.fontSize)
  const raw = cs.getPropertyValue('--mdo-space-advance').trim()
  const n = Number.parseFloat(raw)
  if (raw.endsWith('px') && Number.isFinite(n)) return n
  if (raw.endsWith('em') && Number.isFinite(n)) return n * fs
  return 0.2 * fs
}

const FONT_PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-variation-settings',
  'font-feature-settings',
  'letter-spacing',
] as const

/**
 * Measures lines from the DOM: each rendered `.cm-line` is cloned into one hidden copy of the
 * editor's scope (inside `view.dom`, so the set scope on #editor, `--mdo-scale`, `.mdo-preview`
 * and `.mdo-present` all apply), unwrapped (`.mdo-par-measure`), and read in one layout pass.
 *
 * Widths: a set line has no browser wrapping, but its trailing space stays in the DOM before
 * the break and takes its advance, so the available width is the line's content box minus one
 * space advance. In the preview that is exactly the set's measure (theme.css widens
 * `.cm-content` by one space advance for CodeMirror's break-spaces); Typst trims that space.
 * - body line: measure = content box − space advance, the same for every line;
 * - list item: the hanging indent is its padding, so its content box is the item body's
 *   uniform width (Typst's list body); the marker sits before the content box via the
 *   negative text-indent, so line 0 counts from its first char (lineWidth(0) = width minus that
 *   char's offset from the content box's left edge, which the engine then counts from the
 *   item's text);
 * - quotes and alerts: their paddings and the alert bar narrow the content box the same way;
 * - Present: its 70ch column has no extra space advance (theme.css), so lines are set in 70ch
 *   minus one space. Harmless: Present deliberately differs from the PDF's measure anyway.
 */
export function domMeasurer(): LineMeasurer {
  let batch: Map<number, Measured | null> | null = null
  return {
    begin(view, lines) {
      batch = measureLines(view, lines)
    },
    measure(view, line) {
      const hit = batch?.get(line.from)
      if (hit !== undefined) return hit
      return measureLines(view, [line]).get(line.from) ?? null
    },
    end() {
      batch = null
    },
  }
}

interface Pending {
  line: Line
  orig: HTMLElement
  clone: HTMLElement
  walk: LineWalk
  cloneNodes: Text[]
}

function measureLines(view: EditorView, lines: readonly Line[]): Map<number, Measured | null> {
  const out = new Map<number, Measured | null>()
  const doc = view.dom.ownerDocument
  // Widths of a fallback font would set the paragraph wrongly until the real one arrives.
  if (doc.fonts?.status === 'loading') {
    for (const l of lines) out.set(l.from, null)
    return out
  }
  const scroller = doc.createElement('div')
  scroller.className = view.scrollDOM.className
  scroller.setAttribute('aria-hidden', 'true')
  scroller.style.cssText =
    'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;contain:layout paint;height:auto;overflow:visible'
  const content = doc.createElement('div')
  content.className = view.contentDOM.className
  content.style.width = `${view.contentDOM.offsetWidth}px`
  content.style.maxWidth = 'none'
  scroller.append(content)

  const pending: Pending[] = []
  for (const line of lines) {
    const orig = lineElement(view, line)
    if (!orig) {
      out.set(line.from, null)
      continue
    }
    const clone = orig.cloneNode(true) as HTMLElement
    clone.classList.add('mdo-par-measure')
    // Measure the text as it is, not as it was last set.
    for (const e of clone.querySelectorAll('.mdo-par-eol')) e.remove()
    for (const e of clone.querySelectorAll('.mdo-par-adjust')) e.removeAttribute('style')
    content.append(clone)
    const walk = walkLine(view, orig)
    pending.push({ line, orig, clone, walk, cloneNodes: textNodes(clone) })
  }
  if (pending.length === 0) return out

  // Outside contentDOM, so CodeMirror's mutation observer never sees it; removed before paint.
  view.dom.append(scroller)
  try {
    const space = spaceAdvancePx(view)
    const range = doc.createRange()
    const fonts = new Map<string, { parent: HTMLElement; width: number }>()
    const fontOf: Array<{ p: Pending; keys: string[] }> = []
    const reads: Array<{ p: Pending; x: Float64Array; avail: number; left: number; size: number }> =
      []
    // Pass 1: positions (the only layout of the clones).
    for (const p of pending) {
      const { walk, cloneNodes, clone, orig } = p
      if (cloneNodes.length !== walk.nodes.length) {
        out.set(p.line.from, null)
        continue
      }
      const x = new Float64Array(walk.text.length + 1)
      const keys: string[] = []
      let i = 0
      let right = Number.NEGATIVE_INFINITY
      for (const t of cloneNodes) {
        const parent = t.parentElement as HTMLElement
        const cs = getComputedStyle(parent)
        const key = FONT_PROPS.map((k) => cs.getPropertyValue(k)).join('|')
        if (!fonts.has(key)) fonts.set(key, { parent, width: Number.NaN })
        for (let k = 0; k < t.data.length; k++, i++) {
          keys[i] = key
          const code = t.data.charCodeAt(k)
          // The low half of a surrogate pair: no break can fall there, it shares the left edge.
          if (code >= 0xdc00 && code <= 0xdfff && k > 0) {
            x[i] = x[i - 1] ?? Number.NaN
            continue
          }
          const end = code >= 0xd800 && code <= 0xdbff && k + 1 < t.data.length ? k + 2 : k + 1
          range.setStart(t, k)
          range.setEnd(t, end)
          const r = range.getBoundingClientRect()
          x[i] = r.left
          right = Math.max(right, r.right)
        }
      }
      // The right edge includes trailing widgets without text (the ↗ after a link).
      range.selectNodeContents(clone)
      x[walk.text.length] = Math.max(right, range.getBoundingClientRect().right)
      const os = getComputedStyle(orig)
      const padL = Number.parseFloat(os.paddingLeft)
      const padR = Number.parseFloat(os.paddingRight)
      const avail = orig.clientWidth - padL - padR - space
      const left = clone.getBoundingClientRect().left + clone.clientLeft + padL
      const size = Number.parseFloat(getComputedStyle(clone).fontSize)
      reads.push({ p, x, avail, left, size })
      fontOf.push({ p, keys })
    }
    // Pass 2: one '-' per distinct font, in an element of that font (exact cascade).
    const probes: Array<{ key: string; span: HTMLElement }> = []
    for (const [key, f] of fonts) {
      const span = doc.createElement('span')
      span.textContent = '-'
      f.parent.append(span)
      probes.push({ key, span })
    }
    for (const { key, span } of probes) {
      const f = fonts.get(key)
      if (f) f.width = span.getBoundingClientRect().width
    }
    reads.forEach(({ p, x, avail, left, size }, k) => {
      const keys = fontOf[k]?.keys ?? []
      const hyphen = (i: number) => fonts.get(keys[Math.max(0, i - 1)] ?? '')?.width ?? Number.NaN
      const ok =
        avail > 0 &&
        size > 0 &&
        x.every(Number.isFinite) &&
        (p.walk.text.length === 0 || (x[p.walk.text.length] ?? 0) - (x[0] ?? 0) > 0)
      out.set(
        p.line.from,
        ok
          ? {
              text: p.walk.text,
              x,
              docPos: p.walk.docPos,
              lineWidth: (n) => (n === 0 ? avail - ((x[0] ?? 0) - left) : avail),
              hyphenWidth: hyphen,
              fontSize: () => size,
            }
          : null,
      )
    })
  } finally {
    scroller.remove()
  }
  return out
}

// ── the plugin ─────────────────────────────────────────────────────────────────────────────

/** CodeMirror's `MeasureRequest` (not exported by @codemirror/view). */
interface MeasureRequest<T> {
  read(view: EditorView): T
  write?(measure: T, view: EditorView): void
  key?: unknown
}

/** Dispatched after a measure pass brought new results, so the decorations are rebuilt. */
const paragraphsMeasured = StateEffect.define<null>()

const CACHE_MAX = 2000
const defaultWarn = onceWarner()
/**
 * A width change that returns to the width before the current one within this time is taken
 * as an oscillation, not a resize: setting changes line heights, which can toggle a classic
 * scrollbar, which changes the width back (theme.css reserves the gutter, this is the backstop).
 */
const WIDTH_BURST_MS = 1000

interface ReadResult {
  env: Env
  results: Map<string, SetResult | Failure>
}

/** The preview's paragraph setting, with injectable measurer and engine (unit tests). */
export function paragraphs(options: ParagraphsOptions = {}) {
  const o: Required<ParagraphsOptions> = {
    measurer: options.measurer ?? domMeasurer(),
    setParagraph: options.setParagraph ?? setParagraph,
    settings:
      options.settings ??
      ((view, lang) => paragraphSettings(getComputedStyle(view.contentDOM), lang)),
    warn: options.warn ?? defaultWarn,
    tries: options.tries ?? { trieFor, requestTrie },
    now: options.now ?? (() => performance.now()),
  }
  // Shared by every view and tab of this extension: keys carry everything a result depends on,
  // so switching tabs or toggling Present back finds the earlier results. LRU by Map order.
  const cache = new Map<string, SetResult>()
  /** Languages whose hyphenation trie failed to load. */
  const unloadable = new Set<TrieLang>()

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none
      private env: Env | null = null
      /** Keys that could not be set under the current environment (not retried until it changes). */
      private failed = new Set<string>()
      private fontGen = 0
      /** The content width before the current environment's, and when it changed. */
      private prevWidth: { width: number; at: number } | null = null
      private destroyed = false
      private queued = false
      private readonly observers: Array<{ disconnect(): void }> = []
      private readonly request: MeasureRequest<ReadResult | null>
      private readonly onFonts = () => {
        // A loaded font changes widths without changing any key part: a new generation does.
        this.fontGen++
        this.view.requestMeasure(this.request)
      }

      constructor(readonly view: EditorView) {
        this.request = {
          key: this,
          read: (v) => this.read(v),
          write: (r) => this.write(r),
        }
        const remeasure = () => view.requestMeasure(this.request)
        // Content width: window size, zoom (the measure scales), Present's column.
        if (typeof ResizeObserver === 'function') {
          const ro = new ResizeObserver(remeasure)
          ro.observe(view.contentDOM)
          this.observers.push(ro)
        }
        // The set scope and zoom on #editor, the measured space advance on the editor element.
        if (typeof MutationObserver === 'function') {
          const mo = new MutationObserver(remeasure)
          mo.observe(view.dom, { attributes: true, attributeFilter: ['style'] })
          const host = view.dom.parentElement
          if (host)
            mo.observe(host, { attributes: true, attributeFilter: ['style', 'data-mdo-set'] })
          this.observers.push(mo)
        }
        view.dom.ownerDocument.fonts?.addEventListener('loadingdone', this.onFonts)
        view.requestMeasure(this.request)
      }

      update(u: ViewUpdate): void {
        const measured = u.transactions.some((tr) =>
          tr.effects.some((e) => e.is(paragraphsMeasured)),
        )
        const present = u.startState.facet(presentMode) !== u.state.facet(presentMode)
        // Present has another column and size: lines set for the editor would overflow it for a
        // frame. Without an environment they wrap in the browser until the measure set them.
        if (present) this.env = null
        if (
          measured ||
          present ||
          u.docChanged ||
          u.viewportChanged ||
          u.selectionSet ||
          syntaxTree(u.startState) !== syntaxTree(u.state) ||
          u.startState.field(previewSource, false) !== u.state.field(previewSource, false)
        ) {
          // Lines with a known result switch at once (a selection leaving a paragraph shows it
          // set in the same frame); the others are measured after this update.
          this.decorations = this.build()
          if (!measured) u.view.requestMeasure(this.request)
        }
      }

      destroy(): void {
        this.destroyed = true
        for (const ob of this.observers) ob.disconnect()
        this.view.dom.ownerDocument.fonts?.removeEventListener('loadingdone', this.onFonts)
      }

      private candidates(env: Env): Candidate[] {
        const { state } = this.view
        const out: Candidate[] = []
        let last = -1
        for (const { from, to } of this.view.visibleRanges) {
          for (let pos = from; pos <= to; ) {
            const line = state.doc.lineAt(pos)
            pos = line.to + 1
            if (line.number <= last) continue
            last = line.number
            if (!lineIsRendered(state, line)) continue
            const start = paragraphStart(this.view, line)
            if (start === null) continue
            const { sig, nobreak } = lineSignature(this.view, line)
            const key = `${env.key}\u0000${start - line.from}\u0000${sig}\u0000${line.text}`
            out.push({ line, start, key, nobreak })
          }
        }
        return out
      }

      private build(): DecorationSet {
        if (!this.env) return Decoration.none
        const out: Range<Decoration>[] = []
        for (const c of this.candidates(this.env)) {
          const r = cache.get(c.key)
          if (!r) continue
          cache.delete(c.key)
          cache.set(c.key, r)
          decorate(out, c.line.from, r)
        }
        return Decoration.set(out, true)
      }

      /**
       * The measure read phase. The DOM measurer inserts its clone and hyphen probes into the
       * editor here and removes them before returning (finally): a read phase must leave the
       * DOM as it found it, because the other requests of the cycle read it too. Their layout
       * is the same again; at most the next reader pays one more layout pass. Were anything
       * ever left behind, this request would have to stay the cycle's last reader.
       */
      private read(view: EditorView): ReadResult | null {
        if (this.destroyed) return null
        let env = readEnv(view, this.fontGen, o.settings)
        const cur = this.env
        if (
          cur &&
          env.base === cur.base &&
          env.width !== cur.width &&
          this.prevWidth?.width === env.width &&
          o.now() - this.prevWidth.at < WIDTH_BURST_MS
        ) {
          // Back to the previous-but-one width at once: keep the current setting (hysteresis).
          env = cur
        }
        const results = new Map<string, SetResult | Failure>()
        const failed = env.key === this.env?.key ? this.failed : new Set<string>()
        const todo = this.candidates(env).filter((c) => !cache.has(c.key) && !failed.has(c.key))
        if (todo.length === 0) return { env, results }
        const lang = hyphenLang(env.settings)
        const tries: Partial<Record<TrieLang, Trie>> = {}
        if (lang) {
          const trie = o.tries.trieFor(lang)
          if (trie) tries[lang] = trie
          else if (!unloadable.has(lang)) {
            // Set once the trie is there: breaks without hyphenation would jump a moment later.
            const again = () => {
              if (!this.destroyed) this.view.requestMeasure(this.request)
            }
            o.tries.requestTrie(lang).then(again, (e) => {
              // Never retried in this session: the paragraphs are then set without hyphenation.
              unloadable.add(lang)
              o.warn(`hyphenation patterns (${lang}) not loaded: ${String(e)}`, 'trie')
              again()
            })
            return { env, results }
          }
        }
        o.measurer.begin?.(
          view,
          todo.map((c) => c.line),
        )
        try {
          for (const c of todo) results.set(c.key, setLine(view, c, env, tries, o))
        } finally {
          o.measurer.end?.()
        }
        return { env, results }
      }

      private write(r: ReadResult | null): void {
        if (!r || this.destroyed) return
        const changed = r.env.key !== this.env?.key
        if (changed) {
          this.failed = new Set()
          if (this.env && this.env.base === r.env.base) {
            this.prevWidth = { width: this.env.width, at: o.now() }
          }
        }
        this.env = r.env
        let set = false
        for (const [key, res] of r.results) {
          if ('reason' in res) {
            if (res.kind === null) continue
            // Bounded like the cache: a long session of failing edits must not grow it.
            if (this.failed.size >= CACHE_MAX) this.failed.clear()
            this.failed.add(key)
            o.warn(res.reason, res.kind)
            continue
          }
          set = true
          cache.set(key, res)
          if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
        }
        if ((changed || set) && !this.queued) {
          this.queued = true
          // Not from inside the measure cycle (no dispatch while CodeMirror updates); still
          // before the next paint.
          queueMicrotask(() => {
            this.queued = false
            if (!this.destroyed) this.view.dispatch({ effects: paragraphsMeasured.of(null) })
          })
        }
      }
    },
    { decorations: (v) => v.decorations },
  )
}

/** The plugin the editor uses (after `previewPlugin`, whose decorations it reads). */
export const paragraphsPlugin: Extension = paragraphs()

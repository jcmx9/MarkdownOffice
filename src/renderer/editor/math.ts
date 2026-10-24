/**
 * Formulas in Preview and Present as the PDF sets them: a `$…$` or `$$…$$` whose range no
 * selection touches is replaced by the SVG the bundled Typst + mitex made of it (math-render.ts),
 * sized in em of the surrounding text, so it follows headings, zoom and Present without a new
 * render. The Code view, the formula with the cursor and every formula without a result show the
 * source; the note's bytes never change.
 *
 * - Inline (`InlineMath`, also a `$$…$$` written inside a line, then in display style): an
 *   inline widget on the text baseline, revealed like the other inline marks when the selection
 *   touches the formula.
 * - Display (`BlockMath`, a paragraph that is one `$$…$$`): a centred block widget, revealed for
 *   the whole block when the selection touches any of its lines (like tables and Mermaid).
 * - Pending (first sight, ~0.3 s): the source in the muted mark colour, no placeholder box, so
 *   nothing is laid out at a guessed size. Error: the source underlined, the reason as tooltip.
 *
 * The field asks the window's service for every shown formula without a result on each build
 * (the service skips the ones it has or is setting), and the view plugin redraws on its updates.
 */
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { MathItem } from '../../core/math'
import { reprefix } from './diagram-svg'
import { type MathEntry, type MathService, mathRefresh, mathService } from './math-render'
import { mathTex } from './math-syntax'
import { previewView, selectionTouches } from './rendered'

/** Tooltip of a formula the PDF cannot build (mitex's or Typst's message follows). */
export const MATH_ERROR_TITLE = 'Formel wird im PDF nicht gebaut: '

type OkEntry = Extract<MathEntry, { state: 'ok' }>

/**
 * Where the source stays source: code is verbatim, a table's cells are drawn by the table widget
 * (and shown raw as a whole while it is edited), the front matter is the header's source, HTML
 * is passed through untouched.
 */
const SKIP = new Set([
  'FencedCode',
  'CodeBlock',
  'InlineCode',
  'Table',
  'Frontmatter',
  'HTMLBlock',
  'CommentBlock',
])

const pendingMark = Decoration.mark({ class: 'mdo-math-pending', rf: 'math-pending' })

/** Error marks by message: a rebuild hands CodeMirror the same decoration objects. */
const errorMarks = new Map<string, Decoration>()
function errorMark(message: string): Decoration {
  let deco = errorMarks.get(message)
  if (!deco) {
    deco = Decoration.mark({
      class: 'mdo-math-error',
      attributes: { title: `${MATH_ERROR_TITLE}${message}` },
      rf: 'math-error',
    })
    // Messages come from formulas: a note full of distinct errors must not grow this forever.
    if (errorMarks.size > 200) errorMarks.clear()
    errorMarks.set(message, deco)
  }
  return deco
}

/**
 * Id prefixes `mdo-mi<n>`, one per shown copy: the same formula twice in a note shares a cache
 * entry, and its glyph symbols must not share ids in the DOM.
 */
let prefixes = 0
const nextPrefix = (): string => `mdo-mi${++prefixes}`

/** em values rounded like paragraphs.ts rounds px: stable strings, no float noise. */
const em = (value: number): string => `${Math.round(value * 10000) / 10000}em`

/** The widget's padding-block in em (theme.css .mdo-math), for the height estimate. */
const BLOCK_PAD_EM = 0.425
/** px of 1em at the 10pt reference size and zoom 1: only for the height estimate. */
const EM_PX = 10 * (96 / 72)

class MathWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly entry: OkEntry,
    readonly block: boolean,
  ) {
    super()
  }
  override eq(other: MathWidget): boolean {
    // The entry object changes only when the service settles the formula anew.
    return other.key === this.key && other.entry === this.entry && other.block === this.block
  }
  override get estimatedHeight(): number {
    return this.block ? (this.entry.height + 2 * BLOCK_PAD_EM) * EM_PX : -1
  }
  override toDOM(): HTMLElement {
    const wrap = document.createElement(this.block ? 'div' : 'span')
    wrap.className = this.block ? 'mdo-math' : 'mdo-math-inline'
    // A clone of the sanitised tree: DOM nodes only, never markup; with ids of its own.
    const svg = reprefix(
      this.entry.svg.cloneNode(true) as SVGSVGElement,
      this.entry.prefix,
      nextPrefix(),
    )
    // The sanitiser leaves the viewBox size as unitless width/height (CSS px); the formula's
    // size is em of the text around it (pt at the 10pt reference / 10), so it scales with the
    // heading, cell or zoom it sits in as Typst sizes an equation by the surrounding text.
    svg.removeAttribute('width')
    svg.removeAttribute('height')
    svg.style.width = em(this.entry.width)
    svg.style.height = em(this.entry.height)
    // An inline SVG's bottom edge sits on the baseline: lowered by the depth, the formula's own
    // baseline meets the text's (display formulas have depth 0 and no baseline to share).
    if (!this.block) svg.style.verticalAlign = em(-this.entry.depth)
    wrap.append(svg)
    return wrap
  }
  override ignoreEvent(): boolean {
    // CodeMirror handles the click: the cursor lands at the formula, which then shows its source.
    return false
  }
}

interface MathValue {
  deco: DecorationSet
  /** A shown formula waits for its result. */
  pending: boolean
}

function isDisplay(node: SyntaxNode): boolean {
  if (node.name === 'BlockMath') return true
  const open = node.firstChild
  return open !== null && open.name === 'MathMark' && open.to - open.from === 2
}

/**
 * A formula field with its own service. The app uses one per window ({@link math}) on the
 * window's {@link mathService}, shared by all tabs.
 */
export function createMath(opts: { service?: MathService } = {}) {
  const service = opts.service ?? mathService

  function build(state: EditorState): MathValue {
    // Code view: every formula stays source and nothing is set.
    if (!state.facet(previewView)) return { deco: Decoration.none, pending: false }
    const doc = state.doc
    const out: Range<Decoration>[] = []
    const want: MathItem[] = []
    syntaxTree(state).iterate({
      enter: (n) => {
        if (SKIP.has(n.name)) return false
        if (n.name !== 'InlineMath' && n.name !== 'BlockMath') return undefined
        const node = n.node
        // A $$ block of its own at the top level becomes a block over its whole lines; one in
        // a list item or quote stays in its line (a block widget would drop the item's indent
        // and the quote's bar), set in display style as Typst sets it.
        const block = n.name === 'BlockMath' && node.parent?.name === 'Document'
        const from = block ? doc.lineAt(n.from).from : n.from
        const to = block ? doc.lineAt(n.to).to : n.to
        // The formula being edited shows its source and is never sent: no render per keystroke.
        if (selectionTouches(state, from, to)) return false
        const item: MathItem = { tex: mathTex(state, node), display: isDisplay(node) }
        const entry = service.get(item)
        if (entry.state === 'pending') {
          want.push(item)
          out.push(pendingMark.range(n.from, n.to))
        } else if (entry.state === 'error') {
          out.push(errorMark(entry.message).range(n.from, n.to))
        } else {
          const key = `${item.display ? 'D' : 'I'}:${item.tex}`
          out.push(
            Decoration.replace({
              widget: new MathWidget(key, entry, block),
              block,
              rf: block ? 'math-block' : 'math-inline',
            }).range(from, to),
          )
        }
        return false
      },
    })
    // Only formulas without a result: typing elsewhere asks for nothing (and the service skips
    // the ones it is already setting).
    if (want.length > 0) service.request(want)
    return { deco: Decoration.set(out, true), pending: want.length > 0 }
  }

  const field = StateField.define<MathValue>({
    create: build,
    update(value, tr) {
      const rebuild =
        tr.docChanged ||
        tr.selection !== undefined ||
        tr.reconfigured ||
        syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
        tr.effects.some((e) => e.is(mathRefresh))
      return rebuild ? build(tr.state) : value
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  })

  /** Redraws the view when the service settles formulas. */
  const redraw = ViewPlugin.fromClass(
    class {
      private queued = false
      private destroyed = false
      private readonly unsubscribe: () => void
      constructor(readonly view: EditorView) {
        this.unsubscribe = service.onUpdate(() => this.schedule())
        // A tab's stored state was built earlier: results that came meanwhile show at once.
        if (view.state.field(field, false)?.pending) this.schedule()
      }
      /**
       * One redraw per burst of updates, in a microtask: never a dispatch inside another
       * update, even if a listener were ever called synchronously from one.
       */
      private schedule(): void {
        if (this.queued) return
        this.queued = true
        queueMicrotask(() => {
          this.queued = false
          if (!this.destroyed) this.view.dispatch({ effects: mathRefresh.of(null) })
        })
      }
      destroy(): void {
        this.destroyed = true
        this.unsubscribe()
      }
    },
  )

  const extension: Extension = [field, redraw]
  return { field, extension }
}

/** The window's formulas: one service and one cache for every tab. */
export const math = createMath()

import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { MathItem } from '../../core/math'
import { applySubstitutions, smartTypography } from '../../core/typography'
import { renderInline } from './inline-render'
import { referenceLabels } from './link-refs'
import { formulaElement } from './math'
import { type MathEntry, type MathService, mathRefresh, mathService } from './math-render'
import { unescapeCellPipes } from './math-syntax'
import { typoMaskOf } from './typo-mask'

export type Align = 'left' | 'center' | 'right'
export interface TableModel {
  head: string[]
  rows: string[][]
  aligns: Align[]
}

/** The memo set's number/amount test (memo.typ number-re). */
const NUMBER_RE =
  /^[+\-\u2212]?\s*(?:[\u20ac$\u00a3]\s*)?[0-9][0-9.,'\u2009\u00a0 ]*(?:\s*(?:%|\u20ac|\$|\u00a3|EUR|CHF|USD|Std\.?|h|Tage?|Stk\.?))?$/

/** Splits a GFM table row; only `\|` stays in the cell (like GFM, pipes in code spans split). */
export function splitRow(text: string): string[] {
  let t = text.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1)
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (ch === '\\' && t[i + 1] === '|') {
      cur += '|'
      i++
      continue
    }
    if (ch === '|') {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur.trim())
  return out
}

const plain = (cell: string) => cell.replace(/[*_~`]/g, '').trim()

export function tableModel(lines: string[]): TableModel {
  const head = splitRow(lines[0] ?? '')
  const n = head.length
  const pad = (cells: string[]) => Array.from({ length: n }, (_, i) => cells[i] ?? '')
  const rows = lines.slice(2).map((l) => pad(splitRow(l)))
  const delim = pad(splitRow(lines[1] ?? ''))
  const aligns = delim.map((d, i): Align => {
    const left = d.startsWith(':')
    const right = d.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    const filled = rows.map((r) => plain(r[i] ?? '')).filter(Boolean)
    return filled.length > 0 && filled.every((c) => NUMBER_RE.test(c)) ? 'right' : 'left'
  })
  return { head, rows, aligns }
}

/**
 * Column widths as Typst lays out the memo set's tables (`columns: (auto,) * n`), so the
 * preview breaks cells where the PDF does. The browser's automatic table layout instead
 * starts every column at its min-content width and shares the rest in proportion to
 * (max - min): long text columns win and short ones ("Objekt", "Quelle") get squeezed
 * and wrap, unlike in the PDF.
 *
 * Mirrors typst-layout `grid/layouter.rs` (`measure_auto_columns` + `shrink_auto_columns`):
 * each auto column is as wide as its widest cell laid out in the available width (so never
 * wider than `available`). If the sum fits, nothing is stretched: the table stays as wide as
 * its content. Otherwise fair = remaining / overlarge columns; columns that fit in the fair
 * share (and did not fit the previous one) keep their width and leave the pool, until a
 * round removes none; the remaining columns all get the last fair share.
 *
 * @param natural each column's max-content width (cell inset included)
 * @param available the width the table may take (the text width)
 */
export function typstAutoColumns(natural: readonly number[], available: number): number[] {
  if (!(available > 0)) return [...natural]
  const cols = natural.map((w) => Math.min(w, available))
  if (cols.reduce((a, b) => a + b, 0) <= available) return cols
  let fair = Number.NEGATIVE_INFINITY
  let redistribute = available
  let overlarge = cols.length
  let changed = true
  while (changed && overlarge > 0) {
    changed = false
    const last = fair
    fair = redistribute / overlarge
    for (const w of cols) {
      if (w <= fair && w > last) {
        redistribute -= w
        overlarge--
        changed = true
      }
    }
  }
  return cols.map((w) => (w > fair ? fair : w))
}

/**
 * Measures the table's natural column widths and applies {@link typstAutoColumns} as a
 * fixed layout (`<col>` widths, table width = their sum). Runs in CodeMirror's measure
 * cycle: the read phase switches the table to auto layout at width max-content without
 * the col widths (`mdo-table-measure`), reads the head cells and switches back before
 * anything is painted; the write phase only touches the DOM when a width changed, so
 * the ResizeObserver that triggers it settles after one round.
 */
function fitColumns(view: EditorView, wrap: HTMLElement, table: HTMLTableElement): void {
  view.requestMeasure({
    key: table,
    read: () => {
      if (!table.isConnected) return null
      const s = getComputedStyle(wrap)
      const available =
        wrap.clientWidth - Number.parseFloat(s.paddingLeft) - Number.parseFloat(s.paddingRight)
      const head = table.tHead?.rows[0]
      if (!head || !(available > 0)) return null
      // Natural widths: auto layout at max-content without the applied col widths.
      const cols = [...table.querySelectorAll('col')]
      const saved = { width: table.style.width, cols: cols.map((c) => c.style.width) }
      table.classList.add('mdo-table-measure')
      table.style.width = 'max-content'
      for (const c of cols) c.style.width = ''
      const natural = [...head.cells].map((c) => c.getBoundingClientRect().width)
      cols.forEach((c, i) => {
        c.style.width = saved.cols[i] ?? ''
      })
      table.style.width = saved.width
      table.classList.remove('mdo-table-measure')
      return typstAutoColumns(natural, available)
    },
    write: (widths) => {
      if (!widths) return
      const cols = table.querySelectorAll('col')
      const px = widths.map((w) => `${w}px`)
      const width = `${widths.reduce((a, b) => a + b, 0)}px`
      if (table.style.width === width && [...cols].every((c, i) => c.style.width === px[i])) return
      px.forEach((w, i) => {
        const col = cols[i] as HTMLElement | undefined
        if (col) col.style.width = w
      })
      table.style.width = width
      table.classList.add('mdo-table-fitted')
    },
  })
}

/** Per widget DOM: re-fits on resize/zoom (wrap or table size) and when fonts load. */
const fitters = new WeakMap<HTMLElement, () => void>()

function sameLabels(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((l) => b.has(l))
}

/** Entries that draw the same: the cached object, or both still pending (fresh each time). */
function sameEntries(a: readonly MathEntry[], b: readonly MathEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((e, i) => e === b[i] || (e.state === 'pending' && b[i]?.state === 'pending'))
  )
}

/**
 * The formulas in a table's cells as the PDF gets them: the raw source between the marks, with
 * GFM's escaped pipes (`\|`) unescaped, since the table splits the row before the formula is read.
 */
function cellFormulas(state: EditorState, table: SyntaxNode): MathItem[] {
  const out: MathItem[] = []
  syntaxTree(state).iterate({
    from: table.from,
    to: table.to,
    enter: (n) => {
      if (n.name !== 'InlineMath') return undefined
      const [open, close] = n.node.getChildren('MathMark')
      if (open && close && n.from >= table.from && n.to <= table.to) {
        const tex = unescapeCellPipes(state.doc.sliceString(open.to, close.from))
        out.push({ tex, display: open.to - open.from === 2 })
      }
      return false
    },
  })
  return out
}

class TableWidget extends WidgetType {
  constructor(
    readonly model: TableModel,
    readonly source: string,
    /** The document's reference labels: a cell `[21]` is a link only if one matches. */
    readonly labels: ReadonlySet<string>,
    readonly service: MathService,
    /** The cell formulas' entries when built: a settled formula draws the table anew. */
    readonly formulas: readonly MathEntry[],
    /** The note's `lang`: the cells' quotes follow it (the model already holds them). */
    readonly lang: string,
  ) {
    super()
  }
  override eq(other: TableWidget): boolean {
    return (
      other.source === this.source &&
      other.lang === this.lang &&
      sameLabels(other.labels, this.labels) &&
      sameEntries(other.formulas, this.formulas)
    )
  }
  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'mdo-table-wrap'
    const table = document.createElement('table')
    table.className = 'mdo-table'
    // One <col> per column: fitColumns sets their widths (Typst's auto columns).
    const colgroup = document.createElement('colgroup')
    for (let i = 0; i < this.model.head.length; i++) colgroup.append(document.createElement('col'))
    table.append(colgroup)
    // Cell formulas as the inline widget draws them (math.ts), at the cell's text size.
    const pending: MathItem[] = []
    const formula = (item: MathItem, source: string) => {
      const entry = this.service.get(item)
      if (entry.state === 'pending') pending.push(item)
      return formulaElement(entry, item, source)
    }
    const thead = table.createTHead().insertRow()
    for (const cell of this.model.head) {
      const th = document.createElement('th')
      renderInline(cell, th, this.labels, formula)
      thead.append(th)
    }
    const body = table.createTBody()
    this.model.rows.forEach((cells, k) => {
      const tr = body.insertRow()
      // mdo-table-fill: luma(96%) on even y (y = 0 is the head) → every second data row
      if (k % 2 === 1) tr.className = 'mdo-table-stripe'
      cells.forEach((cell, i) => {
        const td = tr.insertCell()
        td.className = `mdo-al-${this.model.aligns[i] ?? 'left'}`
        renderInline(cell, td, this.labels, formula)
      })
    })
    wrap.append(table)
    // A formula settled when the field was built may be evicted by the time the widget draws
    // (or the widget was kept as equal to one built while it was pending): it would stay pending
    // for ever without a request here. The service skips the ones it has or is setting.
    if (pending.length > 0) this.service.request(pending)
    wrap.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      // A single click leaves the table rendered and the cursor where it was, so reading or
      // pointing at it in the preview never flips it to Markdown (owner, 2026-10-27). A double
      // click puts the cursor into the table: the field then shows the Markdown for editing
      // (arrow keys still do as well).
      if (e.detail < 2) return
      view.dispatch({ selection: { anchor: view.posAtDOM(wrap) } })
      view.focus()
    })
    wrap.addEventListener('click', (e) => e.preventDefault())
    // Unit tests pass a stub view and happy-dom may lack ResizeObserver: no fitting there.
    if (typeof view.requestMeasure === 'function' && typeof ResizeObserver === 'function') {
      const fit = () => fitColumns(view, wrap, table)
      // Size changes of the wrap (window, zoom) or the table (font size, fonts) re-fit;
      // the observer's first callback also does the initial fit once the DOM is attached.
      const ro = new ResizeObserver(fit)
      ro.observe(wrap)
      ro.observe(table)
      // Font loads change max-content widths without necessarily resizing the table.
      document.fonts?.addEventListener('loadingdone', fit)
      fitters.set(wrap, () => {
        ro.disconnect()
        document.fonts?.removeEventListener('loadingdone', fit)
      })
    }
    return wrap
  }
  override destroy(dom: HTMLElement): void {
    fitters.get(dom)?.()
    fitters.delete(dom)
  }
  override ignoreEvent(): boolean {
    return true
  }
}

function build(state: EditorState, service: MathService): DecorationSet {
  const out: Range<Decoration>[] = []
  const doc = state.doc
  const tree = syntaxTree(state)
  // Collected once per build and only if a table is shown as widget.
  let labels: Set<string> | undefined
  const want: MathItem[] = []
  tree.iterate({
    enter: (n) => {
      // Only top-level tables (direct children of Document): no deep walk into other blocks,
      // so tables inside blockquotes and list items stay raw.
      if (n.name === 'Document') return undefined
      if (n.name !== 'Table') return false
      const from = doc.lineAt(n.from).from
      const to = doc.lineAt(Math.max(n.from, n.to - 1)).to
      const touched = state.selection.ranges.some((r) => r.from <= to && r.to >= from)
      if (!touched) {
        const source = doc.sliceString(from, to)
        // The PDF's typography runs over the raw row lines before cmarker splits them
        // (markdown.typ smart-typography; it never adds or removes a `|` or `\`), so the
        // cells show the same quotes, dashes and ellipses as the PDF's table.
        const tm = typoMaskOf(state)
        const lang = tm.lang
        const first = doc.lineAt(from).number - 1
        const rows = source
          .split('\n')
          .map((l, i) => (tm.mask[first + i] ? l : applySubstitutions(l, smartTypography(l, lang))))
        labels ??= referenceLabels(tree, (a, b) => doc.sliceString(a, b))
        // Only a shown table asks for its formulas; one being edited shows its source.
        const items = cellFormulas(state, n.node)
        const formulas = items.map((item) => service.get(item))
        formulas.forEach((e, i) => {
          if (e.state === 'pending') want.push(items[i] as MathItem)
        })
        out.push(
          Decoration.replace({
            widget: new TableWidget(tableModel(rows), source, labels, service, formulas, lang),
            block: true,
            rf: 'table',
          }).range(from, to),
        )
      }
      return false
    },
  })
  // The service skips formulas it has or is setting; math.ts's plugin redraws on its updates.
  if (want.length > 0) service.request(want)
  return Decoration.set(out)
}

/**
 * Preview-only: tables as PDF-like widgets while the cursor is elsewhere. Cell formulas come
 * from `service` (the window's by default) and are redrawn on {@link mathRefresh}, which the
 * formula extension (math.ts) dispatches when the service settles formulas.
 */
export function createTableField(opts: { service?: MathService } = {}) {
  const service = opts.service ?? mathService
  return StateField.define<DecorationSet>({
    create: (state) => build(state, service),
    update(deco, tr) {
      const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state)
      const refresh = tr.effects.some((e) => e.is(mathRefresh))
      return tr.docChanged || tr.selection || treeChanged || refresh
        ? build(tr.state, service)
        : deco
    },
    provide: (f) => EditorView.decorations.from(f),
  })
}

/** The editor's table field, on the window's formula service. */
export const tableField = createTableField()

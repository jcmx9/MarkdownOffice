import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { renderInline } from './inline-render'
import { referenceLabels } from './link-refs'

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

function sameLabels(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((l) => b.has(l))
}

class TableWidget extends WidgetType {
  constructor(
    readonly model: TableModel,
    readonly source: string,
    /** The document's reference labels: a cell `[21]` is a link only if one matches. */
    readonly labels: ReadonlySet<string>,
  ) {
    super()
  }
  override eq(other: TableWidget): boolean {
    return other.source === this.source && sameLabels(other.labels, this.labels)
  }
  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'mdo-table-wrap'
    const table = document.createElement('table')
    table.className = 'mdo-table'
    const thead = table.createTHead().insertRow()
    for (const cell of this.model.head) {
      const th = document.createElement('th')
      renderInline(cell, th, this.labels)
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
        renderInline(cell, td, this.labels)
      })
    })
    wrap.append(table)
    wrap.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      // Into the table: the field then shows the Markdown for editing.
      view.dispatch({ selection: { anchor: view.posAtDOM(wrap) } })
      view.focus()
    })
    wrap.addEventListener('click', (e) => e.preventDefault())
    return wrap
  }
  override ignoreEvent(): boolean {
    return true
  }
}

function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  const doc = state.doc
  const tree = syntaxTree(state)
  // Collected once per build and only if a table is shown as widget.
  let labels: Set<string> | undefined
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
        labels ??= referenceLabels(tree, (a, b) => doc.sliceString(a, b))
        out.push(
          Decoration.replace({
            widget: new TableWidget(tableModel(source.split('\n')), source, labels),
            block: true,
            rf: 'table',
          }).range(from, to),
        )
      }
      return false
    },
  })
  return Decoration.set(out)
}

/** Preview-only: tables as PDF-like widgets while the cursor is elsewhere. */
export const tableField = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state)
    return tr.docChanged || tr.selection || treeChanged ? build(tr.state) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

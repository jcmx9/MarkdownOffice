import { redo, undo } from '@codemirror/commands'
import { Annotation, type EditorState } from '@codemirror/state'
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { type CellPos, cellAt, cellsOfTable, tableAt } from './table-edit'

/**
 * Tables are edited in place in Preview and Present (owner, 2026-10-27: switching a table to its
 * Markdown „stört massiv“). The table stays the rendered widget (tables.ts); a click into a cell
 * turns only that cell into a small plain-text editor showing the cell's own Markdown, so
 * `**fett**`, `\|` and links stay editable byte for byte, and it renders again when left.
 *
 * The cell editor mirrors CodeMirror: every input is one change of exactly the cell's source
 * range (nothing else in the note moves), and its caret is CodeMirror's selection, so undo,
 * the toolbar's formats and table commands, search and autosave work as anywhere else. After
 * a change from outside (undo, a format button) the editor takes the cell's text again.
 */

/** Marks transactions the cell editor dispatches itself (typing, caret moves). */
const cellEdit = Annotation.define<boolean>()

/** The class of the editable element inside a cell (styles in theme.css). */
export const CELL_EDIT_CLASS = 'mdo-cell-edit'

/** The edit typing made to a cell's text, made safe for a table row. */
export interface CellInput {
  /** Replaced range in the old text. */
  start: number
  end: number
  insert: string
  /** The new cell text (old text with the insert). */
  text: string
  /** Caret after the insert, in the new text. */
  caret: number
}

/**
 * The change that turns the cell text `before` into what the editor now shows (`after`):
 * common prefix and suffix kept, the rest replaced. In the inserted part a line break becomes a
 * space (a table row is one line) and a `|` becomes `\|` unless already escaped (a bare one
 * would split the cell). Null when nothing changed.
 */
export function cellInput(before: string, after: string): CellInput | null {
  if (before === after) return null
  let start = 0
  const max = Math.min(before.length, after.length)
  while (start < max && before[start] === after[start]) start++
  let tail = 0
  while (tail < max - start && before[before.length - 1 - tail] === after[after.length - 1 - tail])
    tail++
  const raw = after.slice(start, after.length - tail).replace(/\r\n|\r|\n/g, ' ')
  let insert = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] as string
    const prev = i > 0 ? raw[i - 1] : before[start - 1]
    insert += ch === '|' && prev !== '\\' ? '\\|' : ch
  }
  const end = before.length - tail
  const text = before.slice(0, start) + insert + before.slice(end)
  return { start, end, insert, text, caret: start + insert.length }
}

/** Where a key moves from a cell: Tab, Shift+Tab, Enter. */
export type CellMove = 'next' | 'prev' | 'down'

/**
 * The cell a move lands in, or null when it leaves the table. `cells` are the table's rows in
 * source order (`cellsOfTable`); the delimiter row (1) is skipped and only the header's columns
 * count, as only those are drawn. Next/previous run along the row and wrap to the next/previous
 * row; down keeps the column.
 */
export function neighbourCell(
  cells: readonly CellPos[][],
  row: number,
  col: number,
  move: CellMove,
): CellPos | null {
  const n = cells[0]?.length ?? 0
  const rows = cells.map((_, i) => i).filter((i) => i !== 1)
  const at = (r: number, c: number) => (c < n ? (cells[r]?.[c] ?? null) : null)
  const k = rows.indexOf(row)
  if (k < 0) return null
  if (move === 'down') {
    const r = rows[k + 1]
    return r === undefined ? null : at(r, col)
  }
  if (move === 'next') {
    if (col + 1 < Math.min(n, cells[row]?.length ?? 0)) return at(row, col + 1)
    const r = rows[k + 1]
    return r === undefined ? null : at(r, 0)
  }
  if (col > 0) return at(row, col - 1)
  const r = rows[k - 1]
  if (r === undefined) return null
  return at(r, Math.min(n, cells[r]?.length ?? 0) - 1)
}

/** The editable cell at `pos`: a header or body cell of a drawn column, never the delimiter row. */
export function editableCell(state: EditorState, pos: number): CellPos | null {
  if (state.readOnly) return null
  const table = tableAt(state, pos)
  if (!table) return null
  const cell = cellAt(state, pos)
  if (!cell || cell.row === 1) return null
  const n = cellsOfTable(state, table)[0]?.length ?? 0
  return cell.col < n ? cell : null
}

/**
 * Per table widget DOM: draws one cell (`[data-row][data-col]`) again with the widget it shows
 * now. tables.ts registers it; the cell editor calls it when a cell is left.
 */
export const cellPainters = new WeakMap<HTMLElement, (td: HTMLElement) => void>()

/** Text offsets of the selection inside `el` (one text node or none). */
function offsetsIn(el: HTMLElement): { a: number; b: number } | null {
  const sel = el.ownerDocument.getSelection()
  if (!sel?.anchorNode || !el.contains(sel.anchorNode) || !sel.focusNode) return null
  const off = (node: Node, o: number) => (node === el ? (o > 0 ? el.textContent?.length : 0) : o)
  return {
    a: off(sel.anchorNode, sel.anchorOffset) ?? 0,
    b: off(sel.focusNode, sel.focusOffset) ?? 0,
  }
}

function placeCaret(el: HTMLElement, a: number, b = a): void {
  const sel = el.ownerDocument.getSelection()
  if (!sel) return
  const text = el.firstChild
  if (!text) {
    sel.setBaseAndExtent(el, 0, el, 0)
    return
  }
  const len = text.textContent?.length ?? 0
  const clamp = (v: number) => Math.max(0, Math.min(len, v))
  sel.setBaseAndExtent(text, clamp(a), text, clamp(b))
}

class CellEditing {
  /** The edited cell's text in the document, or null when no cell is edited. */
  range: { from: number; to: number } | null = null
  el: HTMLElement | null = null
  private focusWanted = false
  private scheduled = false

  constructor(readonly view: EditorView) {
    view.dom.ownerDocument.addEventListener('selectionchange', this.onSelection)
  }

  update(u: ViewUpdate): void {
    const r = this.range
    if (r && u.docChanged)
      this.range = { from: u.changes.mapPos(r.from, -1), to: u.changes.mapPos(r.to, 1) }
    const ours = u.transactions.some((t) => t.annotation(cellEdit))
    if (!ours && (u.selectionSet || u.docChanged || u.focusChanged)) {
      const was = this.range !== null
      const { head } = u.state.selection.main
      const cur = this.range
      if (cur && (head < cur.from || head > cur.to)) this.range = null
      const editorFocused = this.view.dom.ownerDocument.activeElement === this.view.contentDOM
      if (!this.range && (was || editorFocused)) {
        // A command, undo or search moved the cursor into a cell: edit that one.
        const cell = editableCell(u.state, head)
        if (cell) this.range = { from: cell.from, to: cell.to }
      }
      if (this.range && editorFocused) this.focusWanted = true
    }
    if (u.state.readOnly) this.range = null
    if (this.range || this.el) this.schedule()
  }

  /** After CodeMirror has drawn the update: the widget DOM then shows the new state. */
  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      this.sync()
    })
  }

  /** Starts editing the cell at `pos` (a click into a drawn cell). */
  start(pos: number): void {
    const cell = editableCell(this.view.state, pos)
    if (!cell) return
    this.range = { from: cell.from, to: cell.to }
    this.focusWanted = true
    this.view.dispatch({ selection: { anchor: cell.to }, annotations: cellEdit.of(true) })
    this.sync()
  }

  /** The drawn cell of the edited range: its table widget's DOM and the cell element. */
  private locate(): HTMLElement | null {
    const r = this.range
    if (!r) return null
    const { state } = this.view
    const cell = cellAt(state, r.from)
    const table = tableAt(state, r.from)
    if (!cell || !table) return null
    for (const wrap of this.view.contentDOM.querySelectorAll<HTMLElement>('.mdo-table-wrap')) {
      let pos: number
      try {
        pos = this.view.posAtDOM(wrap)
      } catch {
        continue
      }
      if (pos !== state.doc.lineAt(table.from).from) continue
      return wrap.querySelector<HTMLElement>(`[data-row="${cell.row}"][data-col="${cell.col}"]`)
    }
    return null
  }

  sync(): void {
    const doc = this.view.dom.ownerDocument
    // An editor whose table was drawn anew (rows or columns changed) is gone with the old DOM.
    if (this.el && !this.el.isConnected) {
      if (doc.activeElement === doc.body || doc.activeElement === null) this.focusWanted = true
      this.el = null
    }
    const td = this.locate()
    if (!td || !this.range) {
      this.range = null
      this.close()
      return
    }
    if (this.el && this.el.parentElement !== td) this.close()
    const text = this.view.state.sliceDoc(this.range.from, this.range.to)
    let el = this.el
    let fresh = false
    if (!el) {
      el = this.open(td)
      fresh = true
    }
    const changed = el.textContent !== text
    if (changed) el.textContent = text
    if (this.focusWanted || ((fresh || changed) && doc.activeElement === el)) {
      if (doc.activeElement !== el) el.focus({ preventScroll: true })
      const { anchor, head } = this.view.state.selection.main
      placeCaret(el, anchor - this.range.from, head - this.range.from)
    }
    this.focusWanted = false
  }

  private open(td: HTMLElement): HTMLElement {
    const el = td.ownerDocument.createElement('span')
    el.className = CELL_EDIT_CLASS
    el.contentEditable = 'plaintext-only'
    el.spellcheck = true
    el.addEventListener('input', this.onInput)
    el.addEventListener('keydown', this.onKey)
    el.addEventListener('beforeinput', this.onBeforeInput)
    td.replaceChildren(el)
    td.classList.add('mdo-cell-editing')
    this.el = el
    return el
  }

  /** Leaves the cell: it is drawn again from the widget. */
  private close(): void {
    const el = this.el
    if (!el) return
    this.el = null
    const td = el.parentElement
    el.removeEventListener('input', this.onInput)
    el.removeEventListener('keydown', this.onKey)
    el.removeEventListener('beforeinput', this.onBeforeInput)
    if (!td) return
    td.classList.remove('mdo-cell-editing')
    const wrap = td.closest<HTMLElement>('.mdo-table-wrap')
    const paint = wrap ? cellPainters.get(wrap) : undefined
    if (paint) paint(td)
    else td.replaceChildren()
  }

  private onInput = (e: Event): void => {
    const el = this.el
    const r = this.range
    if (!el || !r) return
    const before = this.view.state.sliceDoc(r.from, r.to)
    const edit = cellInput(before, el.textContent ?? '')
    if (!edit) return
    if (edit.text !== el.textContent && !(e as InputEvent).isComposing) {
      el.textContent = edit.text
      placeCaret(el, edit.caret)
    }
    this.view.dispatch({
      changes: { from: r.from + edit.start, to: r.from + edit.end, insert: edit.insert },
      selection: { anchor: r.from + edit.caret },
      userEvent: 'input.type',
      annotations: cellEdit.of(true),
    })
  }

  private onBeforeInput = (e: InputEvent): void => {
    // The browser's own undo would not know the note: CodeMirror's history does.
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
      e.preventDefault()
      ;(e.inputType === 'historyUndo' ? undo : redo)(this.view)
    }
  }

  private onSelection = (): void => {
    const el = this.el
    const r = this.range
    if (!el || !r || el.ownerDocument.activeElement !== el) return
    const at = offsetsIn(el)
    if (!at) return
    const anchor = r.from + at.a
    const head = r.from + at.b
    const main = this.view.state.selection.main
    if (main.anchor === anchor && main.head === head) return
    this.view.dispatch({ selection: { anchor, head }, annotations: cellEdit.of(true) })
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.isComposing) return
    const mod = e.metaKey || e.ctrlKey || e.altKey
    let move: CellMove | null = null
    if (e.key === 'Tab' && !mod) move = e.shiftKey ? 'prev' : 'next'
    else if (e.key === 'Enter' && !mod && !e.shiftKey) move = 'down'
    else if (e.key === 'Enter') {
      // No line break in a cell, with any modifier.
      e.preventDefault()
      return
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.leave('after')
      return
    }
    if (!move) return
    e.preventDefault()
    e.stopPropagation()
    this.go(move)
  }

  private go(move: CellMove): void {
    const r = this.range
    if (!r) return
    const { state } = this.view
    const table = tableAt(state, r.from)
    const cell = cellAt(state, r.from)
    if (!table || !cell) return
    const dest = neighbourCell(cellsOfTable(state, table), cell.row, cell.col, move)
    if (!dest) {
      this.leave(move === 'prev' ? 'before' : 'after')
      return
    }
    this.range = { from: dest.from, to: dest.to }
    this.focusWanted = true
    this.view.dispatch({
      selection: { anchor: dest.from, head: dest.to },
      annotations: cellEdit.of(true),
    })
    this.sync()
  }

  /** Leaves the table: the cursor goes to the line after (or before) it, into the note. */
  private leave(where: 'before' | 'after'): void {
    const r = this.range
    if (!r) return
    const { state } = this.view
    const table = tableAt(state, r.from)
    this.range = null
    this.close()
    if (!table) return
    const doc = state.doc
    const first = doc.lineAt(table.from)
    const last = doc.lineAt(Math.max(table.from, table.to - 1))
    const anchor =
      where === 'after'
        ? last.number < doc.lines
          ? doc.line(last.number + 1).from
          : last.to
        : first.number > 1
          ? doc.line(first.number - 1).to
          : first.from
    this.view.dispatch({
      selection: { anchor },
      scrollIntoView: true,
      annotations: cellEdit.of(true),
    })
    this.view.focus()
  }

  destroy(): void {
    this.view.dom.ownerDocument.removeEventListener('selectionchange', this.onSelection)
    this.range = null
    this.close()
  }
}

/** The cell editor of a preview editor (with tableField, preview and Present only). */
export const cellEditing = ViewPlugin.fromClass(CellEditing)

/** Starts editing the drawn cell `td` of the table widget `wrap` (tables.ts, on a click). */
export function editCell(view: EditorView, wrap: HTMLElement, td: HTMLElement): void {
  const plugin = view.plugin(cellEditing)
  if (!plugin) return
  const row = Number(td.dataset.row)
  const col = Number(td.dataset.col)
  let pos: number
  try {
    pos = view.posAtDOM(wrap)
  } catch {
    return
  }
  const table = tableAt(view.state, pos)
  if (!table) return
  const cell = cellsOfTable(view.state, table)[row]?.[col]
  if (cell) plugin.start(cell.from)
}

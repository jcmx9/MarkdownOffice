import { isolateHistory } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import type { ChangeSpec, EditorState } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { frontmatterRange } from './frontmatter'
import { presentMode } from './mode'

/**
 * Table editing for the toolbar's „Tabelle ▾“ and the Format menu: insert a GFM table, add a
 * row below or a column right of the cursor, delete the cursor's row or column.
 *
 * Every command edits minimally (spec „Tables“): only the inserted or deleted cell spans
 * change, so the text, padding and escaped `\|` of all other cells stay byte-identical, and a
 * row without outer pipes keeps that style wherever an empty cell does not force a pipe. One
 * command is one undo step (`input.table.<op>` plus `isolateHistory`). Commands refuse (return
 * false, no change) in Present, in a read-only (frozen) editor and outside a top-level table,
 * since the preview renders top-level tables only (tables.ts `build()`).
 */

/**
 * One cell of a table row. `row` 0 is the header, 1 the delimiter row, 2… the body rows; `col`
 * counts cells by unescaped `|`. `from`/`to` are the cell's text without its padding (document
 * offsets); an empty cell is a point one padding space into the cell, where typing belongs.
 */
export interface CellPos {
  row: number
  col: number
  from: number
  to: number
}

/** A row's cells with their full spans (padding included) and its pipe layout. */
interface RowLayout {
  /** The row's line. */
  line: { from: number; to: number; number: number }
  cells: { span: { from: number; to: number }; from: number; to: number }[]
  /** Positions of the unescaped `|` (document offsets). */
  pipes: number[]
  leading: boolean
  trailing: boolean
  /** End of the row's text without trailing whitespace: where appended cells go. */
  end: number
}

const isSpace = (ch: string | undefined): boolean => ch === ' ' || ch === '\t'

/**
 * Splits one row line exactly like `splitRow` in tables.ts (the preview's split), but keeps
 * offsets: only an unescaped `|` separates; `\|` stays in the cell (also in `\\|`, as there);
 * a leading `|` and a trailing one that is not `\|` are outer pipes, not separators.
 */
function layoutRow(text: string, line: RowLayout['line']): RowLayout {
  let start = 0
  let end = text.length
  while (start < end && isSpace(text[start])) start++
  while (end > start && isSpace(text[end - 1])) end--
  const pipes: number[] = []
  for (let i = start; i < end; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') {
      i++
      continue
    }
    if (text[i] === '|') pipes.push(i)
  }
  const leading = pipes[0] === start
  // A lone `|` is a leading pipe only (splitRow strips the leading one first).
  const last = pipes[pipes.length - 1]
  const trailing = last === end - 1 && !(leading && pipes.length === 1)
  // Separators are the pipes between cells; spans run between them.
  const seps = pipes.slice(leading ? 1 : 0, trailing ? -1 : undefined)
  const bounds = [leading ? start + 1 : 0, ...seps.flatMap((p) => [p, p + 1])]
  bounds.push(trailing ? end - 1 : text.length)
  const cells: RowLayout['cells'] = []
  for (let i = 0; i < bounds.length; i += 2) {
    const a = bounds[i] as number
    const b = bounds[i + 1] as number
    let from = a
    let to = b
    while (from < to && isSpace(text[from])) from++
    while (to > from && isSpace(text[to - 1])) to--
    // Empty: one padding space in (`|   |` → `| ‸  |`), where the user would type.
    if (from === to) from = to = a + Math.min(1, b - a)
    cells.push({
      span: { from: line.from + a, to: line.from + b },
      from: line.from + from,
      to: line.from + to,
    })
  }
  return {
    line,
    cells,
    pipes: pipes.map((p) => line.from + p),
    leading,
    trailing,
    end: line.from + end,
  }
}

const ROW_NODES = new Set(['TableHeader', 'TableDelimiter', 'TableRow'])

/** The table's rows in source order, from its `TableHeader`/`TableDelimiter`/`TableRow` nodes. */
function rowsOf(state: EditorState, table: SyntaxNode): RowLayout[] {
  const out: RowLayout[] = []
  for (let n = table.firstChild; n; n = n.nextSibling) {
    if (!ROW_NODES.has(n.name)) continue
    // The whole line: a row node starts after the indentation, cells are split like splitRow
    // splits the line. (Lezer's own TableCell nodes skip empty cells, so they cannot be used.)
    const line = state.doc.lineAt(n.from)
    if (out.length > 0 && out[out.length - 1]?.line.number === line.number) continue
    out.push(layoutRow(line.text, { from: line.from, to: line.to, number: line.number }))
  }
  return out
}

/**
 * The top-level `Table` node (a direct child of `Document`) containing `pos`, or null. A
 * position in a row's leading whitespace counts too: the node starts after the indentation
 * of its first row (` b | c` after a column delete), but the line is the table's.
 */
export function tableAt(state: EditorState, pos: number): SyntaxNode | null {
  const tree = syntaxTree(state)
  const line = state.doc.lineAt(pos)
  const indent = line.text.length - line.text.trimStart().length
  const tries = [pos, Math.max(pos, line.from + indent)]
  for (const p of tries) {
    for (const side of [1, -1] as const) {
      for (let n: SyntaxNode | null = tree.resolveInner(p, side); n; n = n.parent) {
        if (n.name === 'Table' && n.parent?.name === 'Document') return n
      }
    }
  }
  return null
}

function toCells(row: RowLayout, index: number): CellPos[] {
  return row.cells.map((c, col) => ({ row: index, col, from: c.from, to: c.to }))
}

/** The table's cells per row in source order (header, delimiter, body rows), split like splitRow. */
export function cellsOfTable(state: EditorState, table: SyntaxNode): CellPos[][] {
  return rowsOf(state, table).map(toCells)
}

/** Row and column of `pos` in its row: column = unescaped pipes before `pos`, clamped. */
function locate(rows: RowLayout[], pos: number): { r: number; c: number } | null {
  const r = rows.findIndex((row) => row.line.from <= pos && pos <= row.line.to)
  const row = rows[r]
  if (!row) return null
  // A pipe belongs to the cell on its left; before a leading pipe is the first cell, after a
  // trailing pipe the last one.
  const before = row.pipes.filter((p) => p < pos).length
  const c = Math.min(Math.max(before - (row.leading ? 1 : 0), 0), row.cells.length - 1)
  return { r, c }
}

/** The cell containing `pos` in a top-level table, or null outside one. */
export function cellAt(state: EditorState, pos: number): CellPos | null {
  const table = tableAt(state, pos)
  if (!table) return null
  const rows = rowsOf(state, table)
  const at = locate(rows, pos)
  if (!at) return null
  return toCells(rows[at.r] as RowLayout, at.r)[at.c] ?? null
}

/** Where table commands may act at all: not in Present (it is not read-only), not frozen. */
function editable(state: EditorState): boolean {
  return !state.facet(presentMode) && !state.readOnly
}

interface Context {
  rows: RowLayout[]
  r: number
  c: number
  /** The header's column count. */
  n: number
}

/** The cursor's table, row and column; null when a command must refuse. */
function context(state: EditorState): Context | null {
  if (!editable(state)) return null
  const { from, to, head } = state.selection.main
  const table = tableAt(state, head)
  // A selection that leaves the table: which row or column it means is unclear, so refuse.
  if (
    !table ||
    tableAt(state, from)?.from !== table.from ||
    tableAt(state, to)?.from !== table.from
  )
    return null
  const rows = rowsOf(state, table)
  const at = locate(rows, head)
  if (!at || rows.length < 2) return null
  return { rows, ...at, n: rows[0]?.cells.length ?? 0 }
}

function dispatch(
  view: EditorView,
  op: string,
  changes: ChangeSpec,
  anchor: (map: (pos: number, assoc?: number) => number) => number,
): void {
  const set = view.state.changes(changes)
  view.dispatch({
    changes: set,
    selection: { anchor: anchor((pos, assoc = -1) => set.mapPos(pos, assoc)) },
    scrollIntoView: true,
    userEvent: `input.table.${op}`,
    annotations: isolateHistory.of('full'),
  })
}

/**
 * A new row of `n` empty cells. Always with outer pipes, whatever the table's style: without a
 * leading pipe an empty first cell vanishes (`   |   ` trims to `|`), and a one-column row
 * without pipes would be a blank line that ends the table.
 */
const emptyRow = (n: number): string => `|${'   |'.repeat(n)}`

/** Blocks a table cannot be inserted into (spec „Tables“: where tables are refused today). */
const REFUSED = new Set([
  'Frontmatter',
  'FencedCode',
  'CodeBlock',
  'HTMLBlock',
  'CommentBlock',
  'ProcessingInstructionBlock',
  'Table',
  // The preview renders top-level tables only, so a table in a list or quote stays raw.
  'ListItem',
  'Blockquote',
])

function insertRefused(state: EditorState): boolean {
  const tree = syntaxTree(state)
  // A profile tab is YAML: no Markdown document, no tables.
  if (tree.type.name !== 'Document') return true
  const fm = frontmatterRange(state.doc)
  return state.selection.ranges.some((r) => {
    if (fm && r.from <= fm.to && r.to >= fm.from) return true
    let hit = false
    tree.iterate({
      from: r.from,
      to: r.to,
      enter: (n) => {
        if (REFUSED.has(n.name)) hit = true
        return !hit
      },
    })
    return hit
  })
}

const isBlank = (text: string): boolean => /^\s*$/.test(text)

/**
 * Inserts an empty GFM table of `cols` columns and `rows` rows (the header counts as a row) at
 * the start of the next empty line after the cursor's block, with one blank line before and
 * after where there is none. The cursor lands in the first header cell. 1 ≤ cols ≤ 8 and
 * 1 ≤ rows ≤ 10 (the toolbar grid); refuses other sizes, Present, front matter, code, HTML,
 * tables, lists and quotes.
 */
export function insertTable(view: EditorView, cols: number, rows: number): boolean {
  const { state } = view
  const size = (v: number, max: number) => Number.isInteger(v) && v >= 1 && v <= max
  if (!size(cols, 8) || !size(rows, 10) || !editable(state) || insertRefused(state)) return false
  const nl = state.lineBreak
  const doc = state.doc
  const lines = [
    emptyRow(cols),
    `|${' --- |'.repeat(cols)}`,
    ...Array.from({ length: rows - 1 }, () => emptyRow(cols)),
  ]
  const table = lines.join(nl)

  const line = doc.lineAt(state.selection.main.head)
  // The cursor's block ends on line `end`; on a blank line the cursor has no block.
  let end = line
  if (!isBlank(line.text)) {
    const block = syntaxTree(state).topNode.childAfter(line.from)
    if (block && block.from <= line.to) end = doc.lineAt(Math.max(block.from, block.to))
  }
  const next = isBlank(line.text) ? line : end.number < doc.lines ? doc.line(end.number + 1) : null
  let from: number
  let insert: string
  if (next && isBlank(next.text)) {
    // Into the empty line: it stays behind the table as the blank line after it (or as the
    // note's end); a blank line before is added unless the line above is blank already.
    const above = next.number > 1 ? doc.line(next.number - 1) : null
    from = next.from
    insert = (above && !isBlank(above.text) ? nl : '') + table + nl
  } else {
    // No empty line after the block (end of note or a following line): open one, so the
    // table gets a blank line before and, through the block end's line break, one after.
    from = end.to
    insert = nl + nl + table + nl
  }
  const prefix = insert.length - table.length - nl.length
  dispatch(view, 'insert', { from, insert }, () => from + prefix + 2)
  return true
}

/** Row below the cursor's row (on the header or delimiter row: the first body row). */
export const tableRowBelow: Command = (view) => {
  const ctx = context(view.state)
  if (!ctx) return false
  const after = ctx.rows[Math.max(ctx.r, 1)] as RowLayout
  const nl = view.state.lineBreak
  const at = after.line.to
  dispatch(view, 'row-below', { from: at, insert: nl + emptyRow(ctx.n) }, () => at + nl.length + 2)
  return true
}

/**
 * One empty cell right of the cursor's column in every row, `---` in the delimiter row. A row
 * shorter than the header is padded up to the new column count (a row that lacks the cursor's
 * column would otherwise get the new cell in a wrong column); a longer row keeps its extras.
 */
export const tableColRight: Command = (view) => {
  const ctx = context(view.state)
  if (!ctx) return false
  const { c } = ctx
  // The cursor may sit in an extra cell beyond the header; the new column is then c + 1.
  const target = Math.max(ctx.n, c + 1) + 1
  const changes: ChangeSpec[] = []
  let cursor = { pos: 0, offset: 0 }
  ctx.rows.forEach((row, r) => {
    const cell = r === 1 ? ' --- ' : '   '
    const k = row.cells.length
    // Text appended at the line end; a row without trailing pipe first closes its last cell,
    // since an empty last cell without one would be dropped by the split.
    let tail = ''
    const close = () => (row.trailing || tail ? '' : ' |')
    if (k > c) {
      const sep = row.pipes[c + (row.leading ? 1 : 0)]
      if (sep !== undefined) {
        changes.push({ from: sep + 1, insert: `${cell}|` })
        if (r === ctx.r) cursor = { pos: sep + 1, offset: 1 }
      } else {
        tail = ` |${cell}|`
        if (r === ctx.r) cursor = { pos: row.end, offset: 3 }
      }
      if (k + 1 < target) tail += close() + `${cell}|`.repeat(target - k - 1)
    } else {
      tail = close() + `${cell}|`.repeat(target - k)
    }
    if (tail) changes.push({ from: row.end, insert: tail })
  })
  dispatch(view, 'col-right', changes, (map) => map(cursor.pos) + cursor.offset)
  return true
}

/** Deletes the cursor's body row; the header and delimiter rows cannot be deleted. */
export const tableRowDelete: Command = (view) => {
  const ctx = context(view.state)
  if (!ctx || ctx.r < 2) return false
  const row = ctx.rows[ctx.r] as RowLayout
  // The row that takes its place, else the one above (the header when no body row is left).
  const r = ctx.r + 1 < ctx.rows.length ? ctx.r + 1 : ctx.r > 2 ? ctx.r - 1 : 0
  const dest = ctx.rows[r] as RowLayout
  const target = dest.cells[Math.min(ctx.c, dest.cells.length - 1)]?.from ?? dest.line.from
  // With the line break before it: a body row always has a line above.
  const changes = { from: row.line.from - 1, to: row.line.to }
  dispatch(view, 'row-delete', changes, (map) => map(target, 1))
  return true
}

/**
 * The text to delete for cell `c` of a row: the cell's span (its padding included) and one of
 * its own pipes, nothing of a neighbour, so every other cell keeps its text and padding byte for
 * byte (spec „Tables“): `a | b | c` → ` b | c`, `a | c`, `a | b `. A cell with a pipe on its left
 * takes that pipe; the first cell of a row without leading pipe takes the pipe on its right.
 *
 * Exception, only where the row would otherwise stop being a table row: a row without trailing
 * pipe that drops to one cell needs a pipe after it, since `| A` / `|---` (and a lone `a`)
 * re-parse as a paragraph. Deleting its last cell then keeps the separator as trailing pipe
 * (`| A | B` → `| A |`); deleting its first cell appends ` |` (`| A | B` → `| B |`). A row's
 * only cell is emptied instead (`|  |`, the same as no cells).
 */
function cellDeletion(row: RowLayout, c: number): ChangeSpec[] {
  const k = row.cells.length
  const cell = row.cells[c]
  if (!cell) return []
  if (k === 1) {
    if (cell.from === cell.to) return []
    // A lazy row without any pipe (`x`) would turn blank and end the table: an empty row.
    return [{ from: cell.from, to: cell.to, insert: row.pipes.length > 0 ? '' : '|   |' }]
  }
  const needsPipe = k === 2 && !row.trailing
  if (needsPipe && c === 1) return [{ from: cell.span.from, to: cell.span.to }]
  const own =
    c === 0 && !row.leading
      ? { from: cell.span.from, to: cell.span.to + 1 }
      : { from: cell.span.from - 1, to: cell.span.to }
  return needsPipe ? [own, { from: row.end, insert: ' |' }] : [own]
}

/** Deletes the cursor's column in every row, the delimiter cell included; not the last one. */
export const tableColDelete: Command = (view) => {
  const { state } = view
  const ctx = context(state)
  if (!ctx || ctx.n <= 1) return false
  const changes: ChangeSpec[] = []
  for (const row of ctx.rows) {
    changes.push(...cellDeletion(row, ctx.c))
  }
  // The cursor goes to the cell that takes the column's place, else to the one on its left.
  const own = ctx.rows[ctx.r] as RowLayout
  const dest = own.cells[ctx.c + 1] ?? own.cells[ctx.c - 1] ?? own.cells[ctx.c]
  const target = dest?.from ?? own.line.from
  dispatch(view, 'col-delete', changes, (map) => map(target, 1))
  return true
}

/** Enabled flags for the table menu and grid: in a table, row delete, column delete. */
export function tableCommandState(state: EditorState): {
  inTable: boolean
  rowDelete: boolean
  colDelete: boolean
} {
  const ctx = context(state)
  return {
    inTable: ctx !== null,
    rowDelete: ctx !== null && ctx.r >= 2,
    colDelete: ctx !== null && ctx.n > 1,
  }
}

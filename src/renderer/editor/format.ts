import { isolateHistory } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import {
  CharCategory,
  EditorSelection,
  type EditorState,
  Facet,
  type SelectionRange,
} from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
import type { SyntaxNode, Tree } from '@lezer/common'
import { frontmatterRange } from './frontmatter'
import { presentMode } from './mode'
import { cellAt, cellsOfTable, tableAt } from './table-edit'

/**
 * Format commands for the toolbar and the „Format“ menu (spec „Formatting toolbar“, section 1).
 * They insert or remove plain GFM markers and nothing else: no keymap (owner decision, no
 * shortcuts), no rewriting outside the rules below. One command is one undo step: every
 * transaction carries `input.format.<id>` plus `isolateHistory.of('full')`, so typing right
 * after a click stays a separate step.
 */

/** Every toolbar/menu format; the line formats and link are implemented next to the inline ones. */
export type FormatId =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'mark'
  | 'code'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'numbered'
  | 'task'
  | 'quote'
  | 'link'

type InlineId = 'bold' | 'italic' | 'strike' | 'mark' | 'code'

/**
 * Edit or Present, provided from the mode compartment. Present does not make the editor
 * read-only (the header toggle and the outline still edit), so the commands check it themselves.
 */
export const formatMode = Facet.define<'edit' | 'present', 'edit' | 'present'>({
  combine: (values) => values[0] ?? 'edit',
})

/** Blocks where a marker would print literally or corrupt the block (spec „Refused contexts“). */
const REFUSED_BLOCKS = new Set([
  'Frontmatter',
  'FencedCode',
  'CodeBlock',
  'HTMLBlock',
  'CommentBlock',
  'ProcessingInstructionBlock',
  // A display formula: markers inside `$$…$$` would end up in the Typst math.
  'BlockMath',
])

/**
 * Whether format commands of `kind` must refuse: Present, a read-only (frozen) editor, a YAML
 * profile tab, or any selection range touching the front matter, a code block, an HTML block or
 * comment (a page break is one) or a display formula. `line` formats also refuse in a table
 * (a row prefix would break it); inline formats work in table cells, limited to each cell.
 */
export function refused(state: EditorState, kind: 'inline' | 'line'): boolean {
  // presentMode as well: it comes from the same compartment and keeps Present refused even in a
  // state built without formatMode.
  if (state.facet(formatMode) === 'present' || state.facet(presentMode) || state.readOnly) {
    return true
  }
  const tree = syntaxTree(state)
  if (tree.type.name !== 'Document') return true
  const fm = frontmatterRange(state.doc)
  return state.selection.ranges.some((r) => {
    // A range ending at column 0 of a line does not touch that line (the rule of segments()), so
    // a selection of whole lines right above a fence or table is not refused.
    const to = !r.empty && state.doc.lineAt(r.to).from === r.to ? r.to - 1 : r.to
    if (fm && r.from <= fm.to && to >= fm.from) return true
    let hit = false
    tree.iterate({
      from: r.from,
      to,
      enter: (n) => {
        if (REFUSED_BLOCKS.has(n.name) || (kind === 'line' && n.name === 'Table')) hit = true
        return !hit
      },
    })
    return hit
  })
}

interface InlineSpec {
  /** The syntax node of a run of this format. */
  node: string
  /** Its own mark children, deleted on toggle off. */
  mark: string
  marker: string
}

const INLINE: Record<InlineId, InlineSpec> = {
  bold: { node: 'StrongEmphasis', mark: 'EmphasisMark', marker: '**' },
  italic: { node: 'Emphasis', mark: 'EmphasisMark', marker: '*' },
  strike: { node: 'Strikethrough', mark: 'StrikethroughMark', marker: '~~' },
  mark: { node: 'Highlight', mark: 'HighlightMark', marker: '==' },
  code: { node: 'InlineCode', mark: 'CodeMark', marker: '`' },
}

interface Span {
  from: number
  to: number
}

/** Marks that open a line's content: quote, list, task and ATX heading prefixes. */
const PREFIX_MARKS = new Set(['QuoteMark', 'ListMark', 'TaskMarker', 'HeaderMark'])

const isSpace = (ch: string): boolean => ch === ' ' || ch === '\t'

/** A GFM alert's type marker as the only text of a quote line (`[!WARNING]`). */
const ALERT_LINE = /^\[![A-Za-z]+\]\s*$/

/**
 * The inline content of a non-table line: after its prefixes (`> `, `- `, `- [ ] `, `## `) and
 * before an ATX closing sequence; null for lines without inline text (a Setext underline, a
 * thematic break, a link definition), where a marker would break the block.
 */
function lineContent(
  state: EditorState,
  tree: Tree,
  line: { from: number; to: number },
): Span | null {
  const text = state.doc.sliceString(line.from, line.to)
  let pos = line.from
  let inQuote = false
  for (;;) {
    while (pos < line.to && isSpace(text[pos - line.from] as string)) pos++
    const n = tree.resolveInner(pos, 1)
    if (n.from !== pos || n.to <= pos || !PREFIX_MARKS.has(n.name)) break
    if (n.name === 'HeaderMark' && n.parent?.name.startsWith('SetextHeading')) return null
    if (n.name === 'QuoteMark') inQuote = true
    pos = n.to
  }
  for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === 'HorizontalRule' || n.name === 'LinkReference') return null
    // A table inside a quote or list is no top-level table, so it has no cell model
    // (table-edit.ts); wrapping its whole row (`> **| a | b |**`) would break it.
    if (n.name === 'Table') return null
  }
  // An alert's type line (`> [!NOTE]`): wrapped, the pipeline would no longer see an alert.
  if (inQuote && ALERT_LINE.test(text.slice(pos - line.from))) return null
  let end = line.to
  const close = tree.resolveInner(end, -1)
  if (close.name === 'HeaderMark' && close.from > pos && close.to === end) end = close.from
  while (end > pos && isSpace(state.doc.sliceString(end - 1, end))) end--
  return { from: pos, to: Math.max(pos, end) }
}

/**
 * The cells of a top-level table row on `line` (text without padding), [] on the delimiter row,
 * null when the line is no table row.
 */
function rowCells(state: EditorState, line: { from: number; to: number }): Span[] | null {
  const table = tableAt(state, line.from)
  if (!table) return null
  const rows = cellsOfTable(state, table)
  const r = rows.findIndex((row) => {
    const c = row[0]
    return c !== undefined && c.from >= line.from && c.from <= line.to
  })
  if (r < 0) return null
  return r === 1 ? [] : (rows[r] ?? [])
}

/**
 * The pieces of a selection that get wrapped on their own (spec: a selection crossing a block
 * boundary is split; in a table every cell's part separately). Split per line, not only per
 * block: markdown.typ's `marks()` sets `==` line by line, each quote line carries its `> `, and
 * a marker pair inside one line always parses. A range ending at column 0 of a line does not
 * touch that line (the usual CodeMirror rule).
 */
function segments(state: EditorState, tree: Tree, r: SelectionRange): Span[] {
  const out: Span[] = []
  const first = state.doc.lineAt(r.from).number
  const last = state.doc.lineAt(r.to).number
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n)
    if (n > first && r.to === line.from) continue
    const content = lineContent(state, tree, line)
    const pieces = rowCells(state, line) ?? (content ? [content] : [])
    for (const p of pieces) {
      let from = Math.max(r.from, p.from)
      let to = Math.min(r.to, p.to)
      // A closing marker after whitespace is no closing marker: wrap the text, not its spaces.
      while (from < to && isSpace(state.doc.sliceString(from, from + 1))) from++
      while (to > from && isSpace(state.doc.sliceString(to - 1, to))) to--
      if (from < to) out.push({ from, to })
    }
  }
  return out
}

/** The text part of an inline node, between its opening and closing marks. */
function contentOf(n: SyntaxNode): Span {
  let from = n.from
  let to = n.to
  const first = n.firstChild
  if (first && first.from === n.from && first.name.endsWith('Mark')) from = first.to
  if (n.name === 'Link' || n.name === 'Image') {
    // `[text](url)`: the text ends at the second LinkMark (`]`), the rest is destination.
    let marks = 0
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.name === 'LinkMark' && ++marks === 2) {
        to = c.from
        break
      }
    }
  } else {
    const last = n.lastChild
    if (last && last.to === n.to && last.name.endsWith('Mark') && last !== first) to = last.from
  }
  return { from, to: Math.max(from, to) }
}

/** Spans whose text no marker may enter (it would print literally). */
const OPAQUE = new Set(['InlineCode', 'InlineMath'])

/** Inline runs a wrap must not cut: partly covered ones widen the range to their boundaries. */
const RUNS = new Set([
  'Emphasis',
  'StrongEmphasis',
  'Strikethrough',
  'Highlight',
  'InlineCode',
  'InlineMath',
  'Link',
  'Image',
  'Autolink',
  'Subscript',
  'Superscript',
])

/**
 * Widens `w` over every run it covers only partly (spec „otherwise partly covered runs widen the
 * range to their boundaries“). A range inside a run's text or around a whole run stays: those
 * nest. Runs reaching beyond `bound` (the line or cell) are left alone, so a wrap never crosses
 * a line break or a cell pipe.
 */
function widen(tree: Tree, w: Span, bound: Span): Span {
  let span = w
  for (let changed = true; changed; ) {
    changed = false
    const cur = span
    tree.iterate({
      from: cur.from,
      to: cur.to,
      enter: (n) => {
        if (changed) return false
        if (!RUNS.has(n.name) || n.to <= cur.from || n.from >= cur.to) return undefined
        if (n.from >= cur.from && n.to <= cur.to) return undefined
        const c = contentOf(n.node)
        if (cur.from >= c.from && cur.to <= c.to) return undefined
        if (n.from < bound.from || n.to > bound.to) return undefined
        span = { from: Math.min(cur.from, n.from), to: Math.max(cur.to, n.to) }
        changed = true
        return false
      },
    })
  }
  return span
}

/** Whether `r` lies in the text of an inline node named in `names` (cursor: bounds included). */
function insideOf(tree: Tree, r: Span, names: Set<string>): boolean {
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = tree.resolveInner(r.from, side); n; n = n.parent) {
      if (!names.has(n.name)) continue
      const c = contentOf(n)
      if (r.from >= c.from && r.to <= c.to) return true
    }
  }
  return false
}

/** Runs of `node` the range intersects (a cursor: the run containing it, bounds included). */
function runsAt(tree: Tree, r: Span, node: string): SyntaxNode[] {
  const out: SyntaxNode[] = []
  tree.iterate({
    from: r.from,
    to: r.to,
    enter: (n) => {
      if (n.name !== node) return undefined
      const hit =
        r.from === r.to ? n.from <= r.from && r.from <= n.to : n.from < r.to && n.to > r.from
      if (hit) out.push(n.node)
      return undefined
    },
  })
  return out
}

/** The word at `pos` within `bound` (a cell ends the word at its `|`); empty without one. */
function wordAt(state: EditorState, pos: number, bound: Span): Span {
  const cat = state.charCategorizer(pos)
  const word = (a: number) => cat(state.doc.sliceString(a, a + 1)) === CharCategory.Word
  let from = pos
  let to = pos
  while (from > bound.from && word(from - 1)) from--
  while (to < bound.to && word(to)) to++
  return { from, to }
}

/** Markers for a span of text: code takes a fence longer than any backtick run inside it. */
function markersFor(spec: InlineSpec, text: string): [string, string] {
  if (spec.marker !== '`') return [spec.marker, spec.marker]
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length))
  const fence = '`'.repeat(longest + 1)
  // CommonMark strips one space on each side, so a text starting or ending with ` stays intact.
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return [fence + pad, pad + fence]
}

interface Change {
  from: number
  to: number
  insert: string
}

/** Where a range's anchor and head go: a mapped position, or a fixed offset after mapping. */
interface Point {
  pos: number
  assoc: 1 | -1
  offset?: number
}

interface Plan {
  changes: Change[]
  anchor: Point
  head: Point
}

/** The changes for one selection range, or null when it is refused (left unchanged). */
function planRange(state: EditorState, tree: Tree, r: SelectionRange, id: InlineId): Plan | null {
  const spec = INLINE[id]
  // Inside a code span or formula, a marker prints literally; code itself toggles its span.
  const opaque = id === 'code' ? new Set(['InlineMath']) : OPAQUE
  if (insideOf(tree, r, opaque)) return null

  const keep = (): Pick<Plan, 'anchor' | 'head'> => {
    const fwd = r.anchor <= r.head
    return {
      anchor: { pos: r.anchor, assoc: fwd ? 1 : -1 },
      head: { pos: r.head, assoc: fwd ? -1 : 1 },
    }
  }

  // Toggle off: the marks of every intersecting run, its own mark children only (never a literal
  // `*`), so `_x_`, `__x__` and nested runs come apart cleanly: bold off on `***x***` → `*x*`.
  const runs = runsAt(tree, r, spec.node)
  if (runs.length > 0) {
    const changes: Change[] = []
    for (const run of runs) {
      const marks: SyntaxNode[] = []
      for (let c = run.firstChild; c; c = c.nextSibling) if (c.name === spec.mark) marks.push(c)
      const [open, close] = [marks[0], marks[marks.length - 1]]
      let pad = 0
      if (id === 'code' && open && close && open !== close) {
        // CommonMark strips exactly one space on each side of a padded code span (when both
        // sides have one and the text is not all spaces); keeping it would leave double spaces.
        const inner = state.doc.sliceString(open.to, close.from)
        if (inner.length > 1 && /^ .* $/s.test(inner) && /[^ ]/.test(inner)) pad = 1
      }
      for (const [i, c] of marks.entries()) {
        const first = i === 0
        const last = i === marks.length - 1
        changes.push({
          from: c.from - (last && !first ? pad : 0),
          to: c.to + (first && !last ? pad : 0),
          insert: '',
        })
      }
    }
    return { changes, ...keep() }
  }

  const wrap = (w: Span, bound: Span): Change[] => {
    const span = widen(tree, w, bound)
    const [open, close] = markersFor(spec, state.doc.sliceString(span.from, span.to))
    return [
      { from: span.from, to: span.from, insert: open },
      { from: span.to, to: span.to, insert: close },
    ]
  }

  if (r.empty) {
    const cell = cellAt(state, r.head)
    // The delimiter row has no text: markers there would break the table.
    if (cell?.row === 1) return null
    const line = state.doc.lineAt(r.head)
    // A line without inline text (thematic break, Setext underline, link definition, alert type
    // line, a nested table's row): an empty pair there would break the block, so refuse.
    const bound = cell ?? lineContent(state, tree, line)
    if (!bound) return null
    const pos = Math.min(Math.max(r.head, bound.from), bound.to)
    const word = wordAt(state, pos, bound)
    if (word.from === word.to) {
      // No word: an empty pair with the cursor between the markers.
      const [open, close] = markersFor(spec, '')
      const at: Point = { pos, assoc: -1, offset: open.length }
      return { changes: [{ from: pos, to: pos, insert: open + close }], anchor: at, head: at }
    }
    const at: Point = { pos: r.head, assoc: r.head <= word.from ? 1 : -1 }
    return { changes: wrap(word, bound), anchor: at, head: at }
  }

  const changes: Change[] = []
  for (const seg of segments(state, tree, r)) {
    const line = state.doc.lineAt(seg.from)
    const bound = cellAt(state, seg.from) ?? { from: line.from, to: line.to }
    changes.push(...wrap(seg, bound))
  }
  if (changes.length === 0) return null
  return { changes, ...keep() }
}

/**
 * Toggles an inline format on every selection range (spec „Inline formats“): a selection is
 * wrapped (split per line and per table cell), no selection takes the word at the cursor, no
 * word gets an empty marker pair with the cursor inside. A range that touches runs of the format
 * removes their marks instead. The selection stays on the same text. Refuses (false, no change)
 * in the contexts of `refused(state, 'inline')` and when no range could act.
 */
export function toggleInline(id: InlineId): Command {
  return (view: EditorView): boolean => {
    const { state } = view
    if (refused(state, 'inline')) return false
    const tree = syntaxTree(state)
    const plans = state.selection.ranges.map((r) => planRange(state, tree, r, id))
    // Two ranges on the same run or word ask for the same change; it is applied once.
    const unique = new Map<string, Change>()
    for (const plan of plans) {
      for (const c of plan?.changes ?? []) unique.set(`${c.from}:${c.to}:${c.insert}`, c)
    }
    if (unique.size === 0) return false
    const set = state.changes([...unique.values()].sort((a, b) => a.from - b.from || a.to - b.to))
    const place = (p: Point) => set.mapPos(p.pos, p.assoc) + (p.offset ?? 0)
    const ranges = state.selection.ranges.map((r, i) => {
      const plan = plans[i]
      if (!plan) return EditorSelection.range(set.mapPos(r.anchor, 1), set.mapPos(r.head, 1))
      return EditorSelection.range(place(plan.anchor), place(plan.head))
    })
    view.dispatch({
      changes: set,
      selection: EditorSelection.create(ranges, state.selection.mainIndex),
      scrollIntoView: true,
      userEvent: `input.format.${id}`,
      annotations: isolateHistory.of('full'),
    })
    return true
  }
}

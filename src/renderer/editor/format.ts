import { isolateHistory } from '@codemirror/commands'
import { foldedRanges, syntaxTree, unfoldEffect } from '@codemirror/language'
import {
  type ChangeSet,
  CharCategory,
  EditorSelection,
  type EditorState,
  Facet,
  type Line,
  type SelectionRange,
  type StateEffect,
} from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
import type { SyntaxNode, Tree } from '@lezer/common'
import { highlightSpans } from '../../core/highlight'
import { frontmatterRange } from './frontmatter'
import { presentMode } from './mode'
import { blockInsertion, type CellPos, cellAt, cellsOfTable, tableAt } from './table-edit'

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
  // Any 'present' wins (like presentMode): the mode compartment always provides a value, and
  // an extra provider must never be able to switch a Present state back to editable.
  combine: (values) => (values.includes('present') ? 'present' : 'edit'),
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

/** Present, a read-only (frozen) editor or a YAML profile tab: no format command acts at all. */
function blocked(state: EditorState): boolean {
  // presentMode as well: it comes from the same compartment and keeps Present refused even in a
  // state built without formatMode.
  if (state.facet(formatMode) === 'present' || state.facet(presentMode) || state.readOnly) {
    return true
  }
  return syntaxTree(state).type.name !== 'Document'
}

/**
 * Whether format commands of `kind` must refuse: Present, a read-only (frozen) editor, a YAML
 * profile tab, or any selection range touching the front matter, a code block, an HTML block or
 * comment (a page break is one) or a display formula. `line` formats also refuse in a table
 * (a row prefix would break it); inline formats work in table cells, limited to each cell.
 */
export function refused(state: EditorState, kind: 'inline' | 'line'): boolean {
  if (blocked(state)) return true
  const tree = syntaxTree(state)
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

/**
 * Whitespace at the end of a line or piece: a space, a tab, or the `\r` a CRLF line keeps in a
 * mixed-EOL note (that document splits lines on `\n` only, setup.ts), which must never end up
 * inside the markers (`**eins\r**`).
 */
const isTrailing = (ch: string): boolean => isSpace(ch) || ch === '\r'

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
  // Trailing whitespace first, so an ATX closing sequence before it (or before a mixed-EOL `\r`)
  // is still found, then the whitespace before that sequence.
  const trim = (at: number): number => {
    let e = at
    while (e > pos && isTrailing(state.doc.sliceString(e - 1, e))) e--
    return e
  }
  let end = trim(line.to)
  const close = tree.resolveInner(end, -1)
  if (close.name === 'HeaderMark' && close.from > pos && close.to === end) end = trim(close.from)
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
      while (to > from && isTrailing(state.doc.sliceString(to - 1, to))) to--
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

/**
 * Whether `==…==` around `span` would render as a highlight, by the PDF's own rule
 * (core/highlight, markdown.typ `marks()`, which the editor's parser follows): the text holds no
 * `=`, has no space at its ends and is not cut by a backtick or a formula. Checked on the line
 * with the markers in, or on the cell in a table (the editor parses each cell on its own).
 */
function highlightRenders(state: EditorState, span: Span): boolean {
  const scope = cellAt(state, span.from) ?? state.doc.lineAt(span.from)
  const text =
    state.doc.sliceString(scope.from, span.from) +
    '==' +
    state.doc.sliceString(span.from, span.to) +
    '==' +
    state.doc.sliceString(span.to, scope.to)
  const from = span.from - scope.from
  const to = span.to - scope.from + 4
  return highlightSpans(text).some((h) => h.from === from && h.to === to)
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
    // `==` the PDF would not mark stays literal and piles up on the next click (`====x = y====`).
    if (id === 'mark' && !highlightRenders(state, span)) return []
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
 * removes their marks instead. The selection stays on the same text. „Markieren“ skips every
 * piece whose `==…==` would not render (a `=` in it, cut by code or a formula). Refuses (false,
 * no change) in the contexts of `refused(state, 'inline')` and when no range could act.
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

// ---------------------------------------------------------------------------------------------
// Line formats (spec „Line formats“)

type LineId = 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'task' | 'quote'
type ListKind = 'bullet' | 'numbered' | 'task'

const isBlank = (text: string): boolean => /^\s*$/.test(text)

/** The containers whose markers sit in front of a line: quotes and list items. */
const CONTAINERS = new Set(['Blockquote', 'ListItem'])

const HEADING = /^(ATX|Setext)Heading(\d)$/

/**
 * Whether a line lies in the front matter or in a block no line prefix may enter (code, HTML,
 * display formula, table). Such lines are skipped inside a selection (spec „Line formats“), not a
 * reason to refuse the whole command.
 */
function lineRefused(tree: Tree, fm: Span | null, line: Line): boolean {
  if (fm && line.from <= fm.to && line.to >= fm.from) return true
  let hit = false
  tree.iterate({
    from: line.from,
    to: line.to,
    enter: (n) => {
      if (hit) return false
      if (
        (REFUSED_BLOCKS.has(n.name) || n.name === 'Table') &&
        n.from <= line.to &&
        n.to >= line.from
      ) {
        hit = true
      }
      return !hit
    },
  })
  return hit
}

/** The last non-space position of a line: nodes there belong to the line, not to a neighbour. */
const contentEnd = (line: Line): number => line.from + line.text.trimEnd().length

/**
 * The quotes and list items the line belongs to, outermost first. A lazy continuation line
 * counts as part of its quote or item, as in the rendered document.
 */
function chainAt(tree: Tree, line: Line): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let n: SyntaxNode | null = tree.resolveInner(contentEnd(line), -1); n; n = n.parent) {
    if (CONTAINERS.has(n.name)) out.unshift(n)
  }
  return out
}

/** The quotes and list items around `node`, outermost first. */
function ancestorsOf(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let n = node.parent; n; n = n.parent) if (CONTAINERS.has(n.name)) out.unshift(n)
  return out
}

/** The line's own list item: the innermost container when it is a list item (not a quote). */
function itemOf(chain: SyntaxNode[]): SyntaxNode | null {
  const last = chain[chain.length - 1]
  return last?.name === 'ListItem' ? last : null
}

function kindOf(item: SyntaxNode): ListKind {
  if (item.getChild('Task')) return 'task'
  return item.parent?.name === 'OrderedList' ? 'numbered' : 'bullet'
}

/** Where a list item's content starts: after its marker, a task box and their spaces. */
function itemContent(state: EditorState, item: SyntaxNode): number {
  const line = state.doc.lineAt(item.from)
  const at = (p: number) => state.doc.sliceString(p, p + 1)
  let pos = item.firstChild?.name === 'ListMark' ? item.firstChild.to : item.from
  const skip = () => {
    while (pos < line.to && isSpace(at(pos))) pos++
  }
  skip()
  const task = item.getChild('Task')?.getChild('TaskMarker')
  if (task && task.from === pos) {
    pos = task.to
    skip()
  }
  return pos
}

/**
 * The position after the markers of `chain` on `line` (a quote's `> `, a list item's marker or
 * its continuation indent), null when a quote marker is missing (a lazy line).
 */
function afterContainers(state: EditorState, line: Line, chain: SyntaxNode[]): number | null {
  const at = (p: number) => (p < line.to ? state.doc.sliceString(p, p + 1) : '')
  let pos = line.from
  for (const c of chain) {
    if (c.name === 'Blockquote') {
      for (let k = 0; k < 3 && at(pos) === ' '; k++) pos++
      if (at(pos) !== '>') return null
      pos++
      if (isSpace(at(pos))) pos++
      continue
    }
    const first = state.doc.lineAt(c.from)
    const content = itemContent(state, c)
    if (first.number === line.number) {
      pos = content
      continue
    }
    const col = content - first.from
    while (pos - line.from < col && isSpace(at(pos))) pos++
  }
  return pos
}

/** After the line's quote, list and task markers and their spaces (before a heading mark). */
function prefixEnd(state: EditorState, tree: Tree, line: Line): number {
  let pos = line.from
  for (;;) {
    while (pos < line.to && isSpace(state.doc.sliceString(pos, pos + 1))) pos++
    const n = tree.resolveInner(pos, 1)
    if (n.from !== pos || n.to <= pos || n.name === 'HeaderMark' || !PREFIX_MARKS.has(n.name)) {
      return pos
    }
    pos = n.to
  }
}

/**
 * The quote markers a lazy line lacks: `chainAt` counts a lazy continuation line as part of its
 * quote, so a prefix set there must bring the missing `> ` along, or the line would leave the
 * quote (`> a` / `b` + H1 → `> a` / `> # b`, not `# b` outside the quote).
 */
function missingQuotes(state: EditorState, tree: Tree, line: Line, chain: SyntaxNode[]): string {
  if (afterContainers(state, line, chain) !== null) return ''
  const want = chain.filter((c) => c.name === 'Blockquote').length
  const have = (state.doc.sliceString(line.from, prefixEnd(state, tree, line)).match(/>/g) ?? [])
    .length
  return '> '.repeat(Math.max(0, want - have))
}

/** The heading the line belongs to, unless a quote or list item lies in between. */
function headingOf(tree: Tree, line: Line): SyntaxNode | null {
  for (let n: SyntaxNode | null = tree.resolveInner(contentEnd(line), -1); n; n = n.parent) {
    if (HEADING.test(n.name)) return n
    if (CONTAINERS.has(n.name)) return null
  }
  return null
}

const levelOf = (heading: SyntaxNode | null): number =>
  heading ? Number(HEADING.exec(heading.name)?.[2]) : 0

/** Whether the line is a thematic break or link definition: no text a heading could take. */
function textless(tree: Tree, line: Line): boolean {
  for (let n: SyntaxNode | null = tree.resolveInner(contentEnd(line), -1); n; n = n.parent) {
    if (n.name === 'HorizontalRule' || n.name === 'LinkReference') return true
  }
  return false
}

/** An alert's `[!TYPE]` line: a prefix there would end the alert. */
function alertLine(state: EditorState, tree: Tree, line: Line, chain: SyntaxNode[]): boolean {
  if (!chain.some((c) => c.name === 'Blockquote')) return false
  return ALERT_LINE.test(state.doc.sliceString(prefixEnd(state, tree, line), line.to))
}

/** The line where a Setext heading's underline sits. */
function underlineOf(state: EditorState, heading: SyntaxNode): Line | null {
  const mark = heading.lastChild
  return mark?.name === 'HeaderMark' ? state.doc.lineAt(mark.from) : null
}

/** Deletes a Setext underline line together with the line break before it. */
function dropUnderline(state: EditorState, heading: SyntaxNode): Change | null {
  const u = underlineOf(state, heading)
  if (!u || u.number < 2) return null
  return { from: state.doc.line(u.number - 1).to, to: u.to, insert: '' }
}

/**
 * Removes the markers of a whole list (spec: toggle off works on the whole block): the item
 * markers, task boxes included, and the continuation indent up to the item's content column, so
 * a deeper line (`    b` after `10. a`) does not turn into indented code. Indentation in front
 * of a marker stays.
 */
function removeList(state: EditorState, list: SyntaxNode, out: Change[]): void {
  const doc = state.doc
  const outer = ancestorsOf(list)
  for (let n = doc.lineAt(list.from).number; n <= doc.lineAt(list.to).number; n++) {
    const line = doc.line(n)
    if (isBlank(line.text)) continue
    let item: SyntaxNode | null = null
    for (let c = list.firstChild; c; c = c.nextSibling) {
      if (c.name === 'ListItem' && c.from <= line.to && c.to >= line.from) item = c
    }
    const base = afterContainers(state, line, outer)
    if (!item || base === null) continue
    const markLine = doc.lineAt(item.from)
    const content = itemContent(state, item)
    if (markLine.number === n) {
      out.push({ from: item.from, to: content, insert: '' })
      continue
    }
    const contentCol = content - markLine.from
    const from = Math.max(base, line.from + (item.from - markLine.from))
    let to = from
    while (to - line.from < contentCol && to < line.to && isSpace(doc.sliceString(to, to + 1))) {
      to++
    }
    if (to > from) out.push({ from, to, insert: '' })
  }
}

/** Removes one quote's `> ` from each of its lines; lazy lines have none and stay. */
function removeQuote(state: EditorState, quote: SyntaxNode, out: Change[]): void {
  const doc = state.doc
  const outer = ancestorsOf(quote)
  for (let n = doc.lineAt(quote.from).number; n <= doc.lineAt(quote.to).number; n++) {
    const line = doc.line(n)
    const base = afterContainers(state, line, outer)
    if (base === null) continue
    let p = base
    for (let k = 0; k < 3 && doc.sliceString(p, p + 1) === ' '; k++) p++
    if (p >= line.to || doc.sliceString(p, p + 1) !== '>') continue
    const space = p + 1 < line.to && isSpace(doc.sliceString(p + 1, p + 2)) ? 1 : 0
    out.push({ from: p, to: p + 1 + space, insert: '' })
  }
}

/** Sorted, de-duplicated changes; one overlapping an earlier change is dropped. */
function normalize(changes: Change[]): Change[] {
  const sorted = [...changes].sort((a, b) => a.from - b.from || a.to - b.to)
  const out: Change[] = []
  for (const c of sorted) {
    const prev = out[out.length - 1]
    if (prev && prev.from === c.from && prev.to === c.to && prev.insert === c.insert) continue
    if (prev && c.from < prev.to) continue
    out.push(c)
  }
  return out
}

/**
 * Folds a change touches out of sight: a fold fully inside one of the user's selection ranges
 * stays (the user selected it as a whole), any other is unfolded in the same transaction, so
 * nothing changes unseen (spec „Line formats“, folded sections).
 */
function unfoldTouched(
  state: EditorState,
  changes: Change[],
  set: ChangeSet,
): StateEffect<{ from: number; to: number }>[] {
  const effects: StateEffect<{ from: number; to: number }>[] = []
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    const touched = changes.some((c) =>
      c.from === c.to ? c.from > from && c.from <= to : c.from < to && c.to > from,
    )
    const selected = state.selection.ranges.some((r) => r.from <= from && to <= r.to)
    // The fold field maps its ranges before it reads the effects: the effect must name the
    // range in the new document (StateEffect.map does what the field does).
    const effect = touched && !selected ? unfoldEffect.of({ from, to }).map(set) : undefined
    if (effect) effects.push(effect)
  })
  return effects
}

/** The lines the selection touches (a range ending at column 0 does not touch that line). */
function touchedLines(state: EditorState): { lines: number[]; cursors: Set<number> } {
  const doc = state.doc
  const set = new Set<number>()
  const cursors = new Set<number>()
  for (const r of state.selection.ranges) {
    const first = doc.lineAt(r.from).number
    let last = doc.lineAt(r.to).number
    if (last > first && doc.line(last).from === r.to) last--
    for (let n = first; n <= last; n++) set.add(n)
    if (r.empty) cursors.add(first)
  }
  return { lines: [...set].sort((a, b) => a - b), cursors }
}

const LIST_MARKER: Record<ListKind, (n: number) => string> = {
  bullet: () => '- ',
  numbered: (n) => `${n}. `,
  task: () => '- [ ] ',
}

/**
 * Sets or removes a line format on every line the selection touches (spec „Line formats“):
 * - H1–H3 replace an ATX prefix or convert a Setext heading; the same level again (on every
 *   line) makes body text.
 * - Bullet `- `, numbered `1. ` … (counted from 1 over the changed lines per indentation),
 *   task `- [ ] `: one kind replaces the other; a line inside a list item stands for its item.
 * - Quote `> ` at the line start.
 * When every line already is in a list of the same kind (or a quote), the prefix is removed from
 * the whole innermost list or quote instead, so lazy continuation cannot re-attach a single
 * freed line. The prefix edited is the one after container markers, so formats work inside
 * quotes and alerts. Blank lines and lines of refused blocks (front matter, code, HTML, tables)
 * are skipped; refuses (false, no change) when nothing is left, in Present and when frozen.
 */
export function setLinePrefix(id: LineId): Command {
  return (view: EditorView): boolean => {
    const { state } = view
    if (blocked(state)) return false
    const tree = syntaxTree(state)
    const doc = state.doc
    const fm = frontmatterRange(doc)
    const level = id === 'h1' ? 1 : id === 'h2' ? 2 : id === 'h3' ? 3 : 0
    const kind: ListKind | null = id === 'bullet' || id === 'numbered' || id === 'task' ? id : null

    // Target lines: `line` gets the format, `pad` (a Setext underline under a new list item)
    // gets the marker's width in spaces so it stays the item's heading underline.
    const targets = new Map<number, 'line' | 'pad'>()
    const blanks: Line[] = []
    const add = (n: number, role: 'line' | 'pad') => {
      if (targets.get(n) !== 'line') targets.set(n, role)
    }
    const { lines, cursors } = touchedLines(state)
    for (const n of lines) {
      const line = doc.line(n)
      if (lineRefused(tree, fm, line)) continue
      if (isBlank(line.text)) {
        // A cursor on an empty line starts the format there; in a selection blank lines are
        // skipped and not counted.
        if (cursors.has(n)) blanks.push(line)
        continue
      }
      const chain = chainAt(tree, line)
      const heading = headingOf(tree, line)
      const setext = heading?.name.startsWith('Setext') ? heading : null
      if (level) {
        if (textless(tree, line) || alertLine(state, tree, line, chain)) continue
        // The underline stands for its heading's text line.
        add(setext ? doc.lineAt(setext.from).number : n, 'line')
        continue
      }
      if (kind) {
        // A thematic break or link definition has no text an item could hold (`- ***`).
        if (textless(tree, line) || alertLine(state, tree, line, chain)) continue
        const item = itemOf(chain)
        if (item) {
          add(doc.lineAt(item.from).number, 'line')
          continue
        }
      }
      if (setext) {
        // A Setext heading is one unit: prefixing only its text or its underline would break it.
        const u = underlineOf(state, setext)
        for (let k = doc.lineAt(setext.from).number; u && k <= u.number; k++) {
          add(k, kind && k === u.number ? 'pad' : 'line')
        }
        continue
      }
      add(n, 'line')
    }
    const order = [...targets.keys()].sort((a, b) => a - b)
    const formatted = order.filter((n) => targets.get(n) === 'line').map((n) => doc.line(n))
    if (formatted.length === 0 && blanks.length === 0) return false

    const chains = new Map(formatted.map((l) => [l.number, chainAt(tree, l)]))
    const chainOf = (l: Line) => chains.get(l.number) ?? []
    const changes: Change[] = []
    const some = formatted.length > 0
    if (level) {
      const off = some && formatted.every((l) => levelOf(headingOf(tree, l)) === level)
      for (const line of formatted) {
        const h = headingOf(tree, line)
        if (h?.name.startsWith('ATX')) {
          const open = h.firstChild
          if (open?.name !== 'HeaderMark') continue
          if (!off) {
            changes.push({ from: open.from, to: open.to, insert: '#'.repeat(level) })
            continue
          }
          let to = open.to
          while (to < line.to && isSpace(doc.sliceString(to, to + 1))) to++
          changes.push({ from: open.from, to, insert: '' })
          // The closing sequence (`## title ##`) would print literally in body text.
          const close = h.lastChild
          if (close && close !== open && close.name === 'HeaderMark' && close.to === h.to) {
            let from = close.from
            while (from > to && isSpace(doc.sliceString(from - 1, from))) from--
            changes.push({ from, to: close.to, insert: '' })
          }
        } else if (h) {
          // Setext: converted (underline removed, ATX prefix set) or, same level, body text.
          const drop = dropUnderline(state, h)
          if (drop) changes.push(drop)
          if (!off) {
            changes.push({
              from: prefixEnd(state, tree, line),
              to: prefixEnd(state, tree, line),
              insert: `${'#'.repeat(level)} `,
            })
          }
        } else if (!off) {
          const at = prefixEnd(state, tree, line)
          const quote = missingQuotes(state, tree, line, chainOf(line))
          changes.push({ from: at, to: at, insert: `${quote}${'#'.repeat(level)} ` })
        }
      }
      if (!off) {
        for (const b of blanks) {
          changes.push({ from: b.to, to: b.to, insert: `${'#'.repeat(level)} ` })
        }
      }
    } else if (kind) {
      const items = formatted.map((l) => itemOf(chainOf(l)))
      const off = some && items.every((it) => it !== null && kindOf(it) === kind)
      if (off) {
        const lists = new Map<number, SyntaxNode>()
        for (const it of items) if (it?.parent) lists.set(it.parent.from, it.parent)
        for (const list of lists.values()) removeList(state, list, changes)
      } else {
        // Numbering counts per indentation column, so a nested level starts at 1 again.
        const counters = new Map<number, number>()
        let width = 0
        const all = [...order.map((n) => doc.line(n)), ...blanks].sort((a, b) => a.from - b.from)
        for (const line of all) {
          if (targets.get(line.number) === 'pad') {
            const at = prefixEnd(state, tree, line)
            if (width) changes.push({ from: at, to: at, insert: ' '.repeat(width) })
            continue
          }
          const item = isBlank(line.text) ? null : itemOf(chainOf(line))
          const own = item && doc.lineAt(item.from).number === line.number ? item : null
          const from = own ? own.from : isBlank(line.text) ? line.to : prefixEnd(state, tree, line)
          const to = own ? itemContent(state, own) : from
          const col = from - line.from
          for (const k of [...counters.keys()]) if (k > col) counters.delete(k)
          const count = (counters.get(col) ?? 0) + 1
          counters.set(col, count)
          const marker = LIST_MARKER[kind](count)
          width = marker.length
          // A new item on a lazy quote line stays in the quote, as a heading does.
          const quote =
            own || isBlank(line.text) ? '' : missingQuotes(state, tree, line, chainOf(line))
          if (doc.sliceString(from, to) !== quote + marker) {
            changes.push({ from, to, insert: quote + marker })
          }
        }
      }
    } else {
      const quotes = formatted.map((l) =>
        chainOf(l)
          .filter((c) => c.name === 'Blockquote')
          .pop(),
      )
      const off = some && quotes.every((q) => q !== undefined)
      if (off) {
        const unique = new Map<number, SyntaxNode>()
        for (const q of quotes) if (q) unique.set(q.from, q)
        for (const q of unique.values()) removeQuote(state, q, changes)
      } else {
        // Lines already in a quote keep their single `> ` (no nested quote from a mixed range).
        // The `> ` goes after the markers of enclosing list items (spec: the edited prefix is
        // the one after container markers), so `- a` / `  b` gives `  > b` inside the item; the
        // line's own item marker is quoted with it (`- a` → `> - a`, a nested `  - b` →
        // `  > - b`).
        formatted.forEach((line, i) => {
          if (quotes[i]) return
          const chain = chainOf(line)
          const own = itemOf(chain)
          const outer =
            own && doc.lineAt(own.from).number === line.number ? chain.slice(0, -1) : chain
          const at = outer.length ? (afterContainers(state, line, outer) ?? line.from) : line.from
          changes.push({ from: at, to: at, insert: '> ' })
        })
        for (const b of blanks) changes.push({ from: b.to, to: b.to, insert: '> ' })
      }
    }

    const list = normalize(changes)
    if (list.length === 0) return false
    const set = state.changes(list)
    const ranges = state.selection.ranges.map((r) =>
      r.empty
        ? EditorSelection.cursor(set.mapPos(r.head, 1))
        : EditorSelection.range(
            set.mapPos(r.anchor, r.anchor <= r.head ? 1 : -1),
            set.mapPos(r.head, r.anchor <= r.head ? -1 : 1),
          ),
    )
    view.dispatch({
      changes: set,
      selection: EditorSelection.create(ranges, state.selection.mainIndex),
      effects: unfoldTouched(state, list, set),
      scrollIntoView: true,
      userEvent: `input.format.${id}`,
      annotations: isolateHistory.of('full'),
    })
    return true
  }
}

// ---------------------------------------------------------------------------------------------
// Link (spec „Link“)

/** Nodes a link must not enter: markers would print literally or nest a link in a link. */
const NO_LINK = new Set(['InlineCode', 'InlineMath', 'Link', 'Image', 'Autolink', 'URL'])

/** Whether `pos` lies strictly inside a node named in `names`. */
function strictlyIn(tree: Tree, pos: number, names: Set<string>): boolean {
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) {
      if (names.has(n.name) && n.from < pos && pos < n.to) return true
    }
  }
  return false
}

/**
 * The clipboard text as a link destination: one `http(s)://` URL, trimmed, without whitespace
 * inside (spec: „a single http(s):// URL“); anything else counts as no URL. Unbalanced
 * parentheses would end the destination early, so such a URL goes into `<…>`. A trailing `\`
 * would escape the closing `)` (and inside `<…>` the closing `>`), so such text counts as no URL.
 */
function linkDestination(raw: string | null): string | null {
  const url = raw?.trim() ?? ''
  if (!/^https?:\/\/\S+$/i.test(url) || /[<>]/.test(url) || url.endsWith('\\')) return null
  let depth = 0
  for (const ch of url) {
    if (ch === '(') depth++
    else if (ch === ')' && --depth < 0) break
  }
  return depth === 0 ? url : `<${url}>`
}

/**
 * Inserts a link (spec „Link“): a selection becomes `[Selection](|)` with the cursor in the URL;
 * with a clipboard URL it is filled in and the cursor goes after the link. No selection inserts
 * `[|]()` (or `[|](url)`). Works in table cells; refuses in code, formulas, an existing link, a
 * selection over more than one line or cell, and the contexts of `refused(state, 'inline')`.
 * The clipboard is read by the caller (App), only on this click.
 */
export function insertLink(view: EditorView, clipboardUrl: string | null): boolean {
  const { state } = view
  if (refused(state, 'inline')) return false
  const tree = syntaxTree(state)
  const dest = linkDestination(clipboardUrl) ?? ''
  // In a table cell a `|` of the URL would end the cell mid-link (even inside `<…>`); %7C is
  // the same URL to every browser.
  const tailIn = (cell: CellPos | null): string => `](${cell ? dest.replaceAll('|', '%7C') : dest})`
  const changes: Change[] = []
  const places: Point[] = []
  for (const r of state.selection.ranges) {
    if (strictlyIn(tree, r.from, NO_LINK) || strictlyIn(tree, r.to, NO_LINK)) return false
    if (r.empty) {
      const cell = cellAt(state, r.head)
      if (cell?.row === 1) return false
      const tail = tailIn(cell)
      const bound = cell ?? lineContent(state, tree, state.doc.lineAt(r.head))
      if (!bound) return false
      const pos = Math.min(Math.max(r.head, bound.from), bound.to)
      changes.push({ from: pos, to: pos, insert: `[${tail}` })
      places.push({ pos, assoc: -1, offset: 1 })
      continue
    }
    // Link text is inline content of one line (or cell): a selection over several would need
    // one link per piece, which is not what a single click means.
    const segs = segments(state, tree, r)
    const seg = segs[0]
    if (segs.length !== 1 || !seg) return false
    const cell = cellAt(state, seg.from)
    const tail = tailIn(cell)
    const line = state.doc.lineAt(seg.from)
    const span = widen(tree, seg, cell ?? { from: line.from, to: line.to })
    let nested = false
    tree.iterate({
      from: span.from,
      to: span.to,
      enter: (n) => {
        // A bare URL may become the link text (`[https://x.de](…)`); a link, image or
        // autolink inside the text would nest links.
        if (n.name === 'Link' || n.name === 'Image' || n.name === 'Autolink') {
          if (n.from < span.to && n.to > span.from) nested = true
        }
        return !nested
      },
    })
    if (nested) return false
    changes.push({ from: span.from, to: span.from, insert: '[' })
    changes.push({ from: span.to, to: span.to, insert: tail })
    places.push({ pos: span.to, assoc: -1, offset: dest ? tail.length : 2 })
  }
  const set = state.changes(normalize(changes))
  const ranges = places.map((p) =>
    EditorSelection.cursor(set.mapPos(p.pos, p.assoc) + (p.offset ?? 0)),
  )
  view.dispatch({
    changes: set,
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
    scrollIntoView: true,
    userEvent: 'input.format.link',
    annotations: isolateHistory.of('full'),
  })
  return true
}

// ---------------------------------------------------------------------------------------------
// Alert boxes (spec „Box ▾“)

export type AlertType = 'note' | 'tip' | 'important' | 'warning' | 'caution'

/**
 * The Box menu's entries. Labels are the German keyword aliases the pipeline accepts
 * (pipeline/lib/markdown.typ `alert-kinds`, TEMPLATES.md §3), not a set's box titles: the title
 * a box gets in the PDF is the set's business. alerts-sync.test.ts keeps them in sync.
 */
export const ALERT_ENTRIES: ReadonlyArray<{
  type: AlertType
  label: 'Info' | 'Tipp' | 'Wichtig' | 'Hinweis' | 'Achtung'
  keyword: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'
}> = [
  { type: 'note', label: 'Info', keyword: 'NOTE' },
  { type: 'tip', label: 'Tipp', keyword: 'TIP' },
  { type: 'important', label: 'Wichtig', keyword: 'IMPORTANT' },
  { type: 'warning', label: 'Hinweis', keyword: 'WARNING' },
  { type: 'caution', label: 'Achtung', keyword: 'CAUTION' },
]

/**
 * Inserts an alert box with the English GFM keyword (`> [!WARNING]`, portable to GitHub and
 * every set). Without a selection the box goes after the cursor's block, like a table, with a
 * `> ` line holding the cursor; with one, the touched lines (main selection) become the quoted
 * content, blank lines as `>`. One blank line before and after where there is none, so no
 * neighbouring paragraph joins the box lazily. Refused like line formats, tables included.
 */
export function insertAlert(type: AlertType): Command {
  return (view: EditorView): boolean => {
    const { state } = view
    const entry = ALERT_ENTRIES.find((e) => e.type === type)
    if (!entry || refused(state, 'line')) return false
    const nl = state.lineBreak
    const doc = state.doc
    const head = `> [!${entry.keyword}]`
    const r = state.selection.main
    let change: Change
    let cursor: number
    if (r.empty) {
      const text = `${head}${nl}> `
      const { from, insert, start } = blockInsertion(state, text)
      change = { from, to: from, insert }
      cursor = from + start + text.length
    } else {
      const first = doc.lineAt(r.from)
      let last = doc.lineAt(r.to)
      if (last.number > first.number && last.from === r.to) last = doc.line(last.number - 1)
      const body: string[] = []
      for (let n = first.number; n <= last.number; n++) {
        const t = doc.line(n).text
        body.push(isBlank(t) ? '>' : `> ${t}`)
      }
      const blankAt = (n: number) => n < 1 || n > doc.lines || isBlank(doc.line(n).text)
      const before = blankAt(first.number - 1) ? '' : nl
      const after = blankAt(last.number + 1) ? '' : nl
      const content = `${head}${nl}${body.join(nl)}`
      change = { from: first.from, to: last.to, insert: before + content + after }
      cursor = first.from + before.length + content.length
    }
    view.dispatch({
      changes: change,
      selection: { anchor: cursor },
      scrollIntoView: true,
      userEvent: `input.format.alert-${type}`,
      annotations: isolateHistory.of('full'),
    })
    return true
  }
}

// ---------------------------------------------------------------------------------------------
// Active state (spec „Active state“)

/**
 * The formats the main cursor sits in, for the toolbar's `aria-pressed`: inline runs (bounds
 * included, as toggle off sees them), headings H1–H3 (ATX and Setext), a quote or alert, the
 * innermost list item (a task → only task, otherwise bullet or numbered by its parent list) and
 * a top-level table. Read only.
 */
export function activeFormats(state: EditorState): ReadonlySet<FormatId | 'table'> {
  const out = new Set<FormatId | 'table'>()
  const tree = syntaxTree(state)
  if (tree.type.name !== 'Document') return out
  const head = state.selection.main.head
  const at = { from: head, to: head }
  for (const [id, spec] of Object.entries(INLINE) as [InlineId, InlineSpec][]) {
    if (runsAt(tree, at, spec.node).length > 0) out.add(id)
  }
  let item: SyntaxNode | null = null
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = tree.resolveInner(head, side); n; n = n.parent) {
      const level = levelOf(HEADING.test(n.name) ? n : null)
      if (level >= 1 && level <= 3) out.add(`h${level}` as FormatId)
      if (n.name === 'Blockquote') out.add('quote')
      if (n.name === 'ListItem' && (!item || n.to - n.from < item.to - item.from)) item = n
    }
  }
  if (item) out.add(kindOf(item))
  if (tableAt(state, head)) out.add('table')
  return out
}

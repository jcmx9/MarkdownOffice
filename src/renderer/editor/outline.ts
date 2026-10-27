import { ensureSyntaxTree, foldable, foldedRanges, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

export interface OutlineEntry {
  /** Heading level 1–6 (the absolute #-count, not the depth in the list). */
  level: number
  text: string
  /** Start and end of the heading line. */
  from: number
  to: number
  /** Section fold range (after the heading line), null when the section is empty. */
  fold: { from: number; to: number } | null
  folded: boolean
  /** Listed entries of the next lower levels in this section (headings before any higher one are top-level). */
  children: OutlineEntry[]
}

/** Default number of listed levels: H1 and H2 (settings „Ebenen in der Gliederung“). */
export const OUTLINE_DEPTH_DEFAULT = 2

const HEADING = /^(ATX|Setext)Heading([1-6])$/

function headingText(state: EditorState, from: number, to: number, setext: boolean): string {
  let text: string
  if (setext) {
    // All text lines up to (excluding) the underline, joined with single spaces.
    const first = state.doc.lineAt(from).number
    const last = state.doc.lineAt(to).number - 1
    const lines: string[] = []
    for (let n = first; n <= Math.max(first, last); n++) lines.push(state.doc.line(n).text.trim())
    text = lines.join(' ')
  } else {
    text = state.doc
      .lineAt(from)
      .text.replace(/^\s{0,3}#{1,6}/, '')
      .replace(/\s+#+\s*$/, '')
  }
  return text.trim() || '(ohne Titel)'
}

/**
 * Folds that start at `pos` (a heading line end), as stored in the editor. Like CodeMirror's
 * `findFold`, a section counts as folded by the fold that starts on its heading line, not by
 * an exact range match: a stored fold is mapped through edits, while the section's current
 * range may have grown or shrunk below it.
 */
export function foldsAt(state: EditorState, pos: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  foldedRanges(state).between(pos, pos, (from, to) => {
    if (from === pos) out.push({ from, to })
  })
  return out
}

/**
 * Headings (ATX and Setext) with their section folds, each nested under the nearest preceding
 * heading of a higher level. `depth` levels are listed, counted from the highest level in the
 * note (a note starting at H2 with depth 2 lists H2 and H3), so the relative levels of the
 * outline keep working. Only top-level headings count: headings inside quotes or lists are not
 * sections.
 */
export function outlineEntries(
  state: EditorState,
  depth: number = OUTLINE_DEPTH_DEFAULT,
): OutlineEntry[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state)
  const found: { level: number; from: number; to: number; setext: boolean }[] = []
  const cursor = tree.cursor()
  if (!cursor.firstChild()) return []
  do {
    const m = HEADING.exec(cursor.name)
    if (m)
      found.push({
        level: Number(m[2]),
        from: cursor.from,
        to: cursor.to,
        setext: m[1] === 'Setext',
      })
  } while (cursor.nextSibling())
  if (found.length === 0) return []
  const top = Math.min(...found.map((h) => h.level))
  const deepest = top + Math.min(6, Math.max(1, Math.trunc(depth) || 1)) - 1
  const out: OutlineEntry[] = []
  // Open sections from the outermost in: the next entry nests under the last one of a higher level.
  const open: OutlineEntry[] = []
  for (const h of found) {
    if (h.level > deepest) continue
    const line = state.doc.lineAt(h.from)
    const entry: OutlineEntry = {
      level: h.level,
      text: headingText(state, h.from, h.to, h.setext),
      from: line.from,
      to: line.to,
      fold: foldable(state, line.from, line.to),
      folded: foldsAt(state, line.to).length > 0,
      children: [],
    }
    while (open.length > 0 && (open.at(-1)?.level ?? 0) >= entry.level) open.pop()
    const parent = open.at(-1)
    if (parent) parent.children.push(entry)
    else out.push(entry)
    open.push(entry)
  }
  return out
}

/** The last entry starting at or before `pos` (children at every level included), null before the first. */
export function activeEntry(entries: OutlineEntry[], pos: number): OutlineEntry | null {
  let found: OutlineEntry | null = null
  for (const e of entries) {
    if (e.from > pos) break
    found = activeEntry(e.children, pos) ?? e
  }
  return found
}

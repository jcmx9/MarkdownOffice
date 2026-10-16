import { ensureSyntaxTree, foldable, foldedRanges, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

export interface OutlineEntry {
  level: 1 | 2
  text: string
  /** Start and end of the heading line. */
  from: number
  to: number
  /** Section fold range (after the heading line), null when the section is empty. */
  fold: { from: number; to: number } | null
  folded: boolean
  /** H2 entries under an H1 (empty for H2 entries; H2 before the first H1 are top-level). */
  children: OutlineEntry[]
}

const HEADING = /^(ATX|Setext)Heading([12])$/

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
 * H1 and H2 headings (ATX and Setext) with their section folds, H2 nested under the H1.
 * Only top-level headings count: headings inside quotes or lists are not sections.
 */
export function outlineEntries(state: EditorState): OutlineEntry[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state)
  const out: OutlineEntry[] = []
  const cursor = tree.cursor()
  if (!cursor.firstChild()) return out
  do {
    const m = HEADING.exec(cursor.name)
    if (!m) continue
    const line = state.doc.lineAt(cursor.from)
    const fold = foldable(state, line.from, line.to)
    const entry: OutlineEntry = {
      level: m[2] === '1' ? 1 : 2,
      text: headingText(state, cursor.from, cursor.to, m[1] === 'Setext'),
      from: line.from,
      to: line.to,
      fold,
      folded: foldsAt(state, line.to).length > 0,
      children: [],
    }
    const last = out.at(-1)
    if (entry.level === 2 && last?.level === 1) last.children.push(entry)
    else out.push(entry)
  } while (cursor.nextSibling())
  return out
}

/** The last entry starting at or before `pos` (children included), null before the first. */
export function activeEntry(entries: OutlineEntry[], pos: number): OutlineEntry | null {
  let found: OutlineEntry | null = null
  for (const e of entries) {
    if (e.from > pos) break
    found = e
    for (const c of e.children) {
      if (c.from > pos) break
      found = c
    }
  }
  return found
}

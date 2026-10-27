import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import {
  Compartment,
  type EditorState,
  type Extension,
  Prec,
  type Range,
  StateField,
} from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'

/**
 * Focus mode (owner, 2026-10-27): while a note is shown to others, the chapters not being
 * talked about stay closed, so nobody reads ahead. Only headings are visible: every chapter
 * heading, the headings of the chapter with the cursor, and the text of the section with the
 * cursor. The text is hidden by decorations only, never changed and never folded (folds are
 * the user's own, „Alle ausklappen“ must not end focus).
 */
export const focusCompartment = new Compartment()

const HEADING = /^(ATX|Setext)Heading([1-6])$/

interface Heading {
  level: number
  /** Start of the heading's first line and end of its last line (Setext: the underline). */
  from: number
  to: number
}

/** Top-level headings only, like the outline: headings inside quotes or lists are no sections. */
function headings(state: EditorState): Heading[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state)
  const out: Heading[] = []
  const cursor = tree.cursor()
  if (!cursor.firstChild()) return out
  do {
    const m = HEADING.exec(cursor.name)
    if (m)
      out.push({
        level: Number(m[2]),
        from: state.doc.lineAt(cursor.from).from,
        to: state.doc.lineAt(cursor.to).to,
      })
  } while (cursor.nextSibling())
  return out
}

/**
 * The whole-line ranges focus mode hides for the cursor at `pos`. The chapter level is the
 * highest heading level in the note (H1, or H2 in a note without H1), so a note without H1
 * still keeps an agenda. The active section is the deepest heading at or before `pos`; its
 * text and sub-headings stay. Text before the first heading (front matter, intro) is never
 * hidden: the header toggle owns the front matter.
 */
export function focusHiddenRanges(state: EditorState, pos: number): { from: number; to: number }[] {
  const hs = headings(state)
  if (hs.length === 0) return []
  const top = Math.min(...hs.map((h) => h.level))
  // The section of heading i ends right before the next heading of the same or a higher level.
  const sectionEnd = (i: number): number => {
    const own = hs[i]?.level ?? 0
    for (let j = i + 1; j < hs.length; j++) {
      const h = hs[j]
      if (h && h.level <= own) return h.from - 1
    }
    return state.doc.length
  }
  let active = -1
  hs.forEach((h, i) => {
    if (h.from <= pos) active = i
  })
  let chapter = -1
  for (let i = active; i >= 0; i--) {
    if (hs[i]?.level === top) {
      chapter = i
      break
    }
  }
  const activeEnd = active < 0 ? -1 : sectionEnd(active)
  const chapterEnd = chapter < 0 ? -1 : sectionEnd(chapter)
  // Each heading is two parts: its own line(s) and the body lines up to the next heading.
  const parts: { from: number; to: number; hidden: boolean }[] = []
  hs.forEach((h, i) => {
    const inActive = active >= 0 && h.from >= (hs[active]?.from ?? 0) && h.from <= activeEnd
    const inChapter = chapter >= 0 && h.from >= (hs[chapter]?.from ?? 0) && h.from <= chapterEnd
    parts.push({ from: h.from, to: h.to, hidden: !(h.level === top || inChapter || inActive) })
    const bodyFrom = h.to + 1
    const bodyTo = (hs[i + 1]?.from ?? state.doc.length + 1) - 1
    if (bodyFrom <= bodyTo) parts.push({ from: bodyFrom, to: bodyTo, hidden: !inActive })
  })
  const out: { from: number; to: number }[] = []
  for (const p of parts) {
    if (!p.hidden) continue
    const last = out.at(-1)
    // Neighbouring hidden parts become one range: one block, no gap between them.
    if (last && last.to + 1 === p.from) last.to = p.to
    else out.push({ from: p.from, to: p.to })
  }
  return out
}

const hide = Decoration.replace({ block: true })

function build(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = focusHiddenRanges(state, state.selection.main.head).map((r) =>
    hide.range(r.from, r.to),
  )
  return Decoration.set(ranges)
}

/**
 * Recomputed when the cursor, the text or the parse changes: moving the cursor (outline,
 * click on a heading, a search hit) is what opens a section.
 */
export const focusHiddenField = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState))
      return build(tr.state)
    return value
  },
  // Highest precedence: the hidden block covers rendered tables, diagrams and formulas inside it.
  provide: (f) => [
    Prec.highest(EditorView.decorations.from(f)),
    // Arrow keys jump over hidden text instead of landing in it unseen.
    EditorView.atomicRanges.of((view) => view.state.field(f)),
  ],
})

export function focusExtensions(on: boolean): Extension {
  return on ? [focusHiddenField, EditorView.editorAttributes.of({ class: 'mdo-focus' })] : []
}

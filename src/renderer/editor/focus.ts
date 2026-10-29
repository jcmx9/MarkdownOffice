import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import {
  Compartment,
  EditorState,
  type Extension,
  Facet,
  Prec,
  type Range,
  StateField,
} from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap } from '@codemirror/view'

/**
 * Focus mode (owner, 2026-10-27): while a note is shown to others, nobody reads ahead. Like a
 * slide, only the section with the cursor shows its text, under the chapter headings and the
 * path of headings leading to it (focusHiddenRanges); PageDown/PageUp step to the next one. The text is hidden by decorations only, never changed and never folded (folds are
 * the user's own, „Alle ausklappen“ must not end focus).
 */
export const focusCompartment = new Compartment()

/**
 * Present with the outline shown (owner, 2026-10-29): the outline is the agenda, so the text
 * drops the chapter headings off the path too and shows only the path and the active section,
 * like a slide. Without the outline every chapter heading stays as the agenda.
 */
export const focusPathOnly = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
})

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

/** Index of the deepest heading at or before `pos`, -1 before the first heading. */
function activeIndex(hs: readonly Heading[], pos: number): number {
  let active = -1
  hs.forEach((h, i) => {
    if (h.from <= pos) active = i
  })
  return active
}

/** Body of heading `i`: the lines after it up to the next heading of any level (may be empty). */
function bodyRange(
  state: EditorState,
  hs: readonly Heading[],
  i: number,
): { from: number; to: number } | null {
  const h = hs[i]
  if (!h) return null
  const from = h.to + 1
  const to = (hs[i + 1]?.from ?? state.doc.length + 1) - 1
  return from <= to ? { from, to } : null
}

/**
 * The whole-line ranges focus mode hides for the cursor at `pos`. Like a slide (owner,
 * 2026-10-27: participants must not see too much at once): every chapter heading stays as the
 * agenda, plus the path of headings from the active section's chapter down to it, plus the
 * active heading's own text up to the next heading of any level. Sibling and sub-headings and
 * all other text are hidden. The chapter level is the highest heading level in the note (H1,
 * or H2 in a note without H1), so a note without H1 still keeps an agenda. The active section
 * is the deepest heading at or before `pos`. Text before the first heading (front matter,
 * intro) is never hidden: the header toggle owns the front matter.
 */
export function focusHiddenRanges(
  state: EditorState,
  pos: number,
  pathOnly = state.facet(focusPathOnly),
): { from: number; to: number }[] {
  const hs = headings(state)
  if (hs.length === 0) return []
  const top = Math.min(...hs.map((h) => h.level))
  const active = activeIndex(hs, pos)
  // The path: the active heading and every enclosing one (each a level higher than the last).
  const path = new Set<number>()
  let level = 7
  for (let i = active; i >= 0; i--) {
    const h = hs[i]
    if (h && h.level < level) {
      path.add(i)
      level = h.level
    }
  }
  // Each heading is two parts: its own line(s) and the body lines up to the next heading.
  const parts: { from: number; to: number; hidden: boolean }[] = []
  hs.forEach((h, i) => {
    const agenda = !pathOnly && h.level === top
    parts.push({ from: h.from, to: h.to, hidden: !(agenda || path.has(i)) })
    const body = bodyRange(state, hs, i)
    if (body) parts.push({ ...body, hidden: i !== active })
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

/**
 * Where PageDown (dir 1) or PageUp (dir -1) moves the cursor in focus mode: the end of the first
 * line of the next or previous heading that has text of its own, so every step shows a filled
 * slide (a chapter heading followed directly by a sub-heading is skipped; the path still shows
 * it). Null at the first or last such heading, or without headings.
 */
export function focusStepTarget(state: EditorState, pos: number, dir: 1 | -1): number | null {
  const hs = headings(state)
  const filled = (i: number) => {
    const body = bodyRange(state, hs, i)
    return body !== null && state.doc.sliceString(body.from, body.to).trim() !== ''
  }
  const active = activeIndex(hs, pos)
  for (let i = active + dir; i >= 0 && i < hs.length; i += dir) {
    const h = hs[i]
    if (h && filled(i)) return state.doc.lineAt(h.from).to
  }
  return null
}

/** Top of the visible path for the cursor at `pos`: the active section's chapter heading. */
function pathTop(state: EditorState, pos: number): number | null {
  const hs = headings(state)
  const active = activeIndex(hs, pos)
  if (active < 0) return null
  const top = Math.min(...hs.map((h) => h.level))
  for (let i = active; i >= 0; i--) {
    const h = hs[i]
    if (h && h.level === top) return h.from
  }
  return hs[active]?.from ?? null
}

function step(dir: 1 | -1) {
  return (view: EditorView): boolean => {
    const target = focusStepTarget(view.state, view.state.selection.main.head, dir)
    // Consumed even at the ends: the plain page scroll would only show hidden blocks' edges.
    if (target !== null) view.dispatch({ selection: { anchor: target }, userEvent: 'select' })
    return true
  }
}

/**
 * PageDown/PageUp step through the sections like slides (presenter remotes send these keys).
 * Only while focus is on (this keymap lives in focusExtensions); Prec.high so it wins over
 * CodeMirror's page motion.
 */
const focusKeys = Prec.high(
  keymap.of([
    { key: 'PageDown', run: step(1) },
    { key: 'PageUp', run: step(-1) },
  ]),
)

/** Start of the active heading for `pos`, -1 before the first heading. */
function activeOf(state: EditorState, pos: number): number {
  const hs = headings(state)
  return hs[activeIndex(hs, pos)]?.from ?? -1
}

/**
 * A new active section (step, outline click, search hit, arrow keys) scrolls its path to the
 * top of the view: the hidden text above changes, and without this the new slide could sit at
 * the bottom of the window. Appended after the transaction's own scroll request, so it wins.
 * Only for cursor moves: an edit keeps the view where the typing is (and the start state's
 * headings are the transaction's, without computing tr.state twice).
 */
const scrollToSection = EditorState.transactionExtender.of((tr) => {
  if (!tr.selection || tr.docChanged) return null
  const s = tr.startState
  const head = tr.newSelection.main.head
  if (activeOf(s, s.selection.main.head) === activeOf(s, head)) return null
  const top = pathTop(s, head)
  return top === null
    ? null
    : { effects: EditorView.scrollIntoView(top, { y: 'start', yMargin: 24 }) }
})

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
    if (
      tr.docChanged ||
      tr.selection ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState) ||
      // The outline shown or hidden in Present (focusPathOnly).
      tr.state.facet(focusPathOnly) !== tr.startState.facet(focusPathOnly)
    )
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

export function focusExtensions(on: boolean, pathOnly = false): Extension {
  return on
    ? [
        focusPathOnly.of(pathOnly),
        focusHiddenField,
        focusKeys,
        scrollToSection,
        EditorView.editorAttributes.of({ class: 'mdo-focus' }),
      ]
    : []
}

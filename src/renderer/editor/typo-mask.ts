import { type EditorState, StateField, type Text, type Transaction } from '@codemirror/state'
import { MASK_START, type MaskCarry, maskLine, sameCarry } from '../../core/typography'
import { frontmatterFields, frontmatterRange } from './frontmatter'

/**
 * What the preview's typography needs per document: which lines markdown.typ leaves alone
 * (front matter, fences, `$$` blocks, multi-line HTML comments) and the note's `lang`.
 */
export interface TypoMask {
  /** 0-based index of the first body line (strip-frontmatter); lines before it are masked. */
  readonly start: number
  /** Per line (0-based): skipped by smart-typography. */
  readonly mask: readonly boolean[]
  /** Per line: the skip-mask carry before it; one more entry for the end of the document. */
  readonly carry: readonly MaskCarry[]
  readonly lang: string
}

/** Lines run through maskLine: lets the tests see that an edit does not rescan the prefix. */
export const typoMaskWork = { lines: 0 }

/**
 * markdown.typ strip-frontmatter: the body starts after the line closing a leading `---` block
 * (`---` or `...`, trailing whitespace allowed), which is exactly frontmatterRange's block.
 */
function bodyStart(doc: Text): number {
  const range = frontmatterRange(doc)
  return range ? doc.lineAt(range.to).number : 0
}

const OPEN_RE = /^---\s*$/

// memo.typ: lang from the front matter, `de` without; smart-typography tests starts-with("de").
const langOf = (doc: Text): string => frontmatterFields(doc).lang || 'de'

/** Masks lines from `from` on, starting with `c`; stops early via `stop` when it returns true. */
function scan(
  doc: Text,
  start: number,
  from: number,
  c: MaskCarry,
  mask: boolean[],
  carry: MaskCarry[],
  stop?: (i: number, c: MaskCarry) => boolean,
): boolean {
  for (let i = from; i < doc.lines; i++) {
    if (stop?.(i, c)) return true
    // The pipeline strips the front matter before smart-typography: its lines are skipped and
    // the scan starts fresh after it.
    const [masked, next] = i < start ? [true, MASK_START] : maskLine(c, doc.line(i + 1).text)
    typoMaskWork.lines++
    mask.push(masked)
    carry.push(next)
    c = next
  }
  return false
}

function build(doc: Text): TypoMask {
  const start = bodyStart(doc)
  const mask: boolean[] = []
  const carry: MaskCarry[] = [MASK_START]
  scan(doc, start, 0, MASK_START, mask, carry)
  return { start, mask, carry, lang: langOf(doc) }
}

/** The body start of the new document, recomputed only when an edit can move it. */
function newStart(old: TypoMask, tr: Transaction, firstLine: number): number {
  // Below the front matter an edit cannot move its end; without one, only a `---` first line
  // (an unclosed block, which a later `---` closes) or an edit on line 1 can start one.
  const doc = tr.state.doc
  const unclosed = old.start === 0 && OPEN_RE.test(doc.line(1).text)
  return firstLine > old.start && !unclosed ? old.start : bodyStart(doc)
}

/**
 * Rescans from the first changed line and stops as soon as, past the edit, the carry before a
 * line equals the old carry before the same text: everything below is unchanged. Typing in a
 * paragraph therefore rescans one line; opening a fence rescans down to where it closes.
 */
function update(old: TypoMask, tr: Transaction): TypoMask {
  if (!tr.docChanged) return old
  let fromA = Number.POSITIVE_INFINITY
  let toB = 0
  tr.changes.iterChangedRanges((a, _b, _c, d) => {
    fromA = Math.min(fromA, a)
    toB = Math.max(toB, d)
  })
  const doc = tr.state.doc
  const k = tr.startState.doc.lineAt(fromA).number - 1
  const start = newStart(old, tr, k)
  if (start !== old.start) return build(doc)
  const endB = doc.lineAt(toB).number - 1
  const delta = doc.lines - tr.startState.doc.lines
  const mask = old.mask.slice(0, k)
  const carry = old.carry.slice(0, k + 1)
  let tail = -1
  scan(doc, start, k, carry[k] ?? MASK_START, mask, carry, (i, c) => {
    const j = i - delta
    if (i <= endB || j < 0 || j >= old.mask.length) return false
    if (!sameCarry(c, old.carry[j] ?? MASK_START)) return false
    tail = j
    return true
  })
  // concat, not push(...): a long note would overflow the argument list.
  const fullMask = tail >= 0 ? mask.concat(old.mask.slice(tail)) : mask
  const fullCarry = tail >= 0 ? carry.concat(old.carry.slice(tail + 1)) : carry
  // lang only changes with the front matter (or a first line that may start one).
  const lang = k < Math.max(old.start, 1) ? langOf(doc) : old.lang
  return { start, mask: fullMask, carry: fullCarry, lang }
}

export const typoMask = StateField.define<TypoMask>({
  create: (state) => build(state.doc),
  update,
})

/** The field's value, or one built on the spot for a state without the field (tests). */
export function typoMaskOf(state: EditorState): TypoMask {
  return state.field(typoMask, false) ?? build(state.doc)
}

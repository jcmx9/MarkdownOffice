/**
 * The typographic characters the PDF prints, as a port of pipeline/lib/markdown.typ
 * (`smart-typography`, `smart-text`, `smart-quotes`, `skip-mask`, `code-mask`). cmarker runs with smart punctuation off, so these string rules alone
 * decide what the PDF shows for `"`, `'`, `--`, `---` and `...`; the preview shows the same
 * characters without touching the note's bytes, so it reports substitutions (offsets into the
 * source line) instead of a new string.
 *
 * No imports on purpose: pipeline/tests/typography-core.mts runs this file directly under
 * Node's type stripping to compare it with Typst (pipeline/tests/test-typography.sh). Every
 * regex mirrors the Typst one character for character; change both or the parity test fails.
 */

export interface Substitution {
  from: number
  to: number
  text: string
}

/** One output code unit of a piece and the source range it stands for. */
interface Unit {
  from: number
  to: number
  text: string
}

// markdown.typ: rule-line-re, opener-re. `u` so \s and the class match like Rust's regex.
const RULE_LINE_RE = /^\s*\|?[\s:|*_=-]+\|?\s*$/u
const OPENER_RE = /^[\s([{„“‚‘»«–—/-]?$/u
const HTML_IN_LINE_RE = /<[A-Za-z!/]/
// `s`: Rust's `.` only excludes \n, JS's also \r and U+2028/9 (a mixed-EOL line may end in \r).
const DOUBLE_RE = /(^|.)"/gsu
const SINGLE_RE = /(^|.)'/gsu
const APOSTROPHE_RE = /([\p{L}\p{N}])'(\p{L})/gu
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/
const INLINE_CODE_RE = /`[^`]*`/g
// markdown.typ: link-dest-re, link-def-re
const LINK_DEST_RE = /\]\([^)]*\)/g
const LINK_DEF_RE = /^ {0,3}\[[^\]^][^\]]*\]:/

const text = (units: readonly Unit[]): string => units.map((u) => u.text).join('')

/** Typst's `str.replace(pattern, repl)` for a literal: left to right, non-overlapping. */
function replaceLiteral(units: Unit[], pattern: string, repl: string): Unit[] {
  const s = text(units)
  if (!s.includes(pattern)) return units
  const out: Unit[] = []
  for (let i = 0; i < units.length; ) {
    if (s.startsWith(pattern, i)) {
      const first = units[i] as Unit
      const last = units[i + pattern.length - 1] as Unit
      out.push({ from: first.from, to: last.to, text: repl })
      i += pattern.length
    } else {
      out.push(units[i] as Unit)
      i++
    }
  }
  return out
}

/**
 * A regex pass whose match ends in the one quote character to replace (the capture before it
 * stays). Matches come from the string before the pass, like Typst's replace: a quote whose
 * predecessor was eaten by the previous match is left as it is (`a""` -> `a“"`).
 */
function replaceQuote(units: Unit[], re: RegExp, pick: (prev: string) => string): void {
  const s = text(units)
  for (const m of s.matchAll(re)) {
    const prev = m[1] ?? ''
    const unit = units[(m.index ?? 0) + prev.length]
    if (unit) unit.text = pick(prev)
  }
}

/** markdown.typ smart-quotes. Each output code unit is still one unit, so indices line up. */
function smartQuotes(units: Unit[], de: boolean): void {
  const [dqOpen, dqClose, sqOpen, sqClose] = de ? ['„', '“', '‚', '‘'] : ['“', '”', '‘', '’']
  replaceQuote(units, DOUBLE_RE, (prev) => (OPENER_RE.test(prev) ? dqOpen : dqClose))
  // The apostrophe between letters/digits (geht's, 90's) before the single quotes.
  const s = text(units)
  for (const m of s.matchAll(APOSTROPHE_RE)) {
    const unit = units[(m.index ?? 0) + (m[1] ?? '').length]
    if (unit) unit.text = '’'
  }
  replaceQuote(units, SINGLE_RE, (prev) => (OPENER_RE.test(prev) ? sqOpen : sqClose))
}

/** markdown.typ smart-text on one piece of the line, which starts at `offset`. */
function smartText(piece: string, offset: number, de: boolean, out: Substitution[]): void {
  let units: Unit[] = []
  for (let i = 0; i < piece.length; i++) {
    units.push({ from: offset + i, to: offset + i + 1, text: piece.charAt(i) })
  }
  units = replaceLiteral(units, '---', '—')
  units = replaceLiteral(units, '--', '–')
  units = replaceLiteral(units, '...', '…')
  smartQuotes(units, de)
  for (const u of units) {
    if (u.text !== piece.slice(u.from - offset, u.to - offset)) out.push(u)
  }
}

/**
 * markdown.typ smart-outside-links: smart-text on the parts of a piece outside link and image
 * destinations (`](dest "title")` stays as typed, or the title would not parse as one).
 */
function smartOutsideLinks(piece: string, offset: number, de: boolean, out: Substitution[]): void {
  let at = 0
  for (const m of piece.matchAll(LINK_DEST_RE)) {
    smartText(piece.slice(at, m.index), offset + at, de, out)
    at = m.index + m[0].length
  }
  smartText(piece.slice(at), offset + at, de, out)
}

/**
 * The substitutions markdown.typ's smart-typography makes in one line that `skip-mask` does
 * not cover; sorted, non-overlapping, offsets into `line`. Empty for HTML lines, lines with an
 * HTML tag or comment, separator lines (tables, rules, setext underlines) and link reference
 * definitions; link and image destinations with their titles are left alone.
 */
export function smartTypography(line: string, lang: string): Substitution[] {
  const out: Substitution[] = []
  const t = line.trim()
  if (t.startsWith('<') || RULE_LINE_RE.test(t)) return out
  // A link reference definition does not show in the PDF; a footnote (`[^1]:`) does.
  if (LINK_DEF_RE.test(line)) return out
  if (!(line.includes('"') || line.includes("'") || line.includes('--') || line.includes('...'))) {
    return out
  }
  if (HTML_IN_LINE_RE.test(line)) return out
  const de = lang.startsWith('de')
  // Inline code is skipped (split at backticks), and within the rest $…$ formulas.
  let offset = 0
  line.split('`').forEach((p, k) => {
    if (k % 2 === 0) {
      const dollars = p.split('$')
      if (dollars.length >= 3 && dollars.length % 2 === 1) {
        let at = offset
        dollars.forEach((q, j) => {
          if (j % 2 === 0) smartOutsideLinks(q, at, de, out)
          at += q.length + 1
        })
      } else {
        smartOutsideLinks(p, offset, de, out)
      }
    }
    offset += p.length + 1
  })
  return out
}

/**
 * What markdown.typ's skip-mask knows at the start of a line: an open fence, an open multi-line
 * HTML comment, an open `$$` block. The mask of a line depends only on this and the line, so the
 * preview can rescan from an edit on and stop where the carry meets the old one again.
 * Treated as immutable: maskLine returns the same object when nothing changes.
 */
export interface MaskCarry {
  readonly fence: string | null
  readonly comment: boolean
  readonly math: boolean
}

export const MASK_START: MaskCarry = { fence: null, comment: false, math: false }

export const sameCarry = (a: MaskCarry, b: MaskCarry): boolean =>
  a === b || (a.fence === b.fence && a.comment === b.comment && a.math === b.math)

const carry = (c: MaskCarry, change: Partial<MaskCarry>): MaskCarry => {
  const next = { ...c, ...change }
  return sameCarry(next, MASK_START) ? MASK_START : next
}

/**
 * One line of markdown.typ skip-mask: code-mask (fenced code with its fences, HTML comments
 * over several lines) and then display formulas (`$$ … $$` over lines) on the lines code-mask
 * left free. Both passes of the Typst version run per line here; the math pass only reads the
 * code mask of the same line, so one pass gives the same result.
 */
export function maskLine(c: MaskCarry, l: string): [boolean, MaskCarry] {
  let next = c
  let masked: boolean
  // code-mask
  if (c.comment) {
    if (l.includes('-->')) next = carry(next, { comment: false })
    return [true, next]
  }
  const m = FENCE_RE.exec(l)
  if (c.fence === null) {
    if (m) {
      return [true, carry(next, { fence: m[1] ?? null })]
    }
    // A comment still open at the end of the line (inline code does not count).
    const t = l.replace(INLINE_CODE_RE, '')
    const comment = t.includes('<!--') && !(t.split('<!--').pop() ?? '').includes('-->')
    if (comment) next = carry(next, { comment: true })
    masked = comment
  } else {
    const f = m?.[1]
    const ch = c.fence.charAt(0)
    if (f && f.charAt(0) === ch && f.length >= c.fence.length && trimChar(l.trim(), ch) === '') {
      next = carry(next, { fence: null })
    }
    return [true, next]
  }
  if (masked) return [true, next]
  // skip-mask's $$ pass
  const t = l.trim()
  if (next.math) {
    if (t.endsWith('$$')) next = carry(next, { math: false })
    return [true, next]
  }
  if (t.startsWith('$$')) {
    // "$$ x $$" on one line closes right away
    if (t === '$$' || !t.slice(2).trim().endsWith('$$')) next = carry(next, { math: true })
    return [true, next]
  }
  return [false, next]
}

/** Typst's `str.trim(pattern)`: repeated `pattern` removed at both ends. */
function trimChar(s: string, ch: string): string {
  let a = 0
  let b = s.length
  while (a < b && s.charAt(a) === ch) a++
  while (b > a && s.charAt(b - 1) === ch) b--
  return s.slice(a, b)
}

/** markdown.typ skip-mask: code-mask plus display formulas, over a note's lines. */
export function skipMask(lines: readonly string[]): boolean[] {
  let c = MASK_START
  return lines.map((l) => {
    const [masked, next] = maskLine(c, l)
    c = next
    return masked
  })
}

/** markdown.typ smart-typography over a note's lines (front matter already removed). */
export function smartTypographyLines(lines: readonly string[], lang: string): Substitution[][] {
  const mask = skipMask(lines)
  return lines.map((l, i) => (mask[i] ? [] : smartTypography(l, lang)))
}

/** The line as the PDF prints it after `subs` (sorted, non-overlapping). */
export function applySubstitutions(line: string, subs: readonly Substitution[]): string {
  let out = ''
  let at = 0
  for (const s of subs) {
    out += line.slice(at, s.from) + s.text
    at = s.to
  }
  return out + line.slice(at)
}

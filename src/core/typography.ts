/**
 * The typographic characters the PDF prints, as a port of pipeline/lib/markdown.typ
 * (`smart-typography`, `smart-text`, `smart-quotes`, `skip-mask`, `code-mask`,
 * `strip-frontmatter`). cmarker runs with smart punctuation off, so these string rules alone
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
 * The substitutions markdown.typ's smart-typography makes in one line that `skip-mask` does
 * not cover; sorted, non-overlapping, offsets into `line`. Empty for HTML lines, lines with an
 * HTML tag or comment, and separator lines (tables, rules, setext underlines).
 */
export function smartTypography(line: string, lang: string): Substitution[] {
  const out: Substitution[] = []
  const t = line.trim()
  if (t.startsWith('<') || RULE_LINE_RE.test(t)) return out
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
          if (j % 2 === 0) smartText(q, at, de, out)
          at += q.length + 1
        })
      } else {
        smartText(p, offset, de, out)
      }
    }
    offset += p.length + 1
  })
  return out
}

/**
 * markdown.typ code-mask: lines of fenced code blocks (fences included) and of HTML comments
 * that span several lines.
 */
export function codeMask(lines: readonly string[]): boolean[] {
  const mask: boolean[] = []
  let fence: string | null = null
  let comment = false
  for (const l of lines) {
    if (comment) {
      mask.push(true)
      if (l.includes('-->')) comment = false
      continue
    }
    const m = FENCE_RE.exec(l)
    if (fence === null) {
      if (m) {
        fence = m[1] ?? null
        mask.push(true)
      } else {
        // A comment still open at the end of the line (inline code does not count).
        const t = l.replace(INLINE_CODE_RE, '')
        comment = t.includes('<!--') && !(t.split('<!--').pop() ?? '').includes('-->')
        mask.push(comment)
      }
    } else {
      mask.push(true)
      const f = m?.[1]
      const ch = fence.charAt(0)
      if (f && f.charAt(0) === ch && f.length >= fence.length && trimChar(l.trim(), ch) === '') {
        fence = null
      }
    }
  }
  return mask
}

/** Typst's `str.trim(pattern)`: repeated `pattern` removed at both ends. */
function trimChar(s: string, ch: string): string {
  let a = 0
  let b = s.length
  while (a < b && s.charAt(a) === ch) a++
  while (b > a && s.charAt(b - 1) === ch) b--
  return s.slice(a, b)
}

/** markdown.typ skip-mask: code-mask plus display formulas (`$$ … $$` over lines). */
export function skipMask(lines: readonly string[]): boolean[] {
  const mask = codeMask(lines)
  let inMath = false
  lines.forEach((l, i) => {
    if (mask[i]) return
    const t = l.trim()
    if (inMath) {
      mask[i] = true
      if (t.endsWith('$$')) inMath = false
    } else if (t.startsWith('$$')) {
      mask[i] = true
      // "$$ x $$" on one line closes right away
      if (t === '$$' || !t.slice(2).trim().endsWith('$$')) inMath = true
    }
  })
  return mask
}

/** markdown.typ smart-typography over a note's lines (front matter already removed). */
export function smartTypographyLines(lines: readonly string[], lang: string): Substitution[][] {
  const mask = skipMask(lines)
  return lines.map((l, i) => (mask[i] ? [] : smartTypography(l, lang)))
}

/**
 * The index of the first body line, as markdown.typ strip-frontmatter cuts it: after the line
 * that closes a leading `---` block (`---` or `...`); 0 without a closed block.
 */
export function bodyStart(lines: readonly string[]): number {
  if (lines.length === 0 || (lines[0] ?? '').trimEnd() !== '---') return 0
  for (let i = 1; i < lines.length; i++) {
    const t = (lines[i] ?? '').trimEnd()
    if (t === '---' || t === '...') return i + 1
  }
  return 0
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

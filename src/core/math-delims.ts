/**
 * `$…$` and `$$…$$` formulas found the way the PDF finds them: cmarker parses Markdown with
 * pulldown-cmark, whose math rules are mirrored here (specs/math.txt), checked against the
 * bundled cmarker 0.1.10. One scanner for the editor's syntax tree, its typography mask and,
 * later, the CLI/MCP, so a `$` is a formula in all of them or in none.
 *
 * - `$` opens inline math when the next character is no whitespace; the closing `$` must not
 *   follow whitespace. Inline math is never empty.
 * - `$$` opens display math; its content may be empty and may start or end with whitespace.
 * - A backslash escapes the next character (`\$` never opens or closes); `{…}` groups are
 *   skipped, so `$\text{a $x$ b}$` is one formula, and an unbalanced brace means no formula.
 * - A `$` that cannot close ends the attempt (`$x $ x$` is text). A `$$` that finds no closing
 *   `$$` leaves its first `$` as text; the second may still open inline math (`$$a$` → `$` +
 *   formula `a`).
 * - Unlike pulldown-cmark's current spec, the bundled version still lets a digit follow the
 *   closing `$` (`$1$2` is the formula `1`): the PDF decides, so no digit rule.
 */

/** pulldown-cmark's whitespace test is Rust's `is_ascii_whitespace` (U+00A0 is no whitespace). */
const isSpace = (c: string | undefined): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'

/** True if the character at `pos` is escaped by an odd run of backslashes before it. */
function escaped(text: string, pos: number): boolean {
  let n = 0
  for (let i = pos - 1; i >= 0 && text[i] === '\\'; i--) n++
  return n % 2 === 1
}

/**
 * The formula starting at the `$` at `pos`: `end` is the offset after its closing delimiter,
 * `display` is true for `$$…$$`. Null if no formula starts there (also for an escaped `$`).
 */
export function scanInlineMath(
  text: string,
  pos: number,
): { end: number; display: boolean } | null {
  if (text[pos] !== '$' || escaped(text, pos)) return null
  const display = text[pos + 1] === '$'
  const start = pos + (display ? 2 : 1)
  if (!display && (start >= text.length || isSpace(text[start]))) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') {
      i++
    } else if (c === '{') {
      depth++
    } else if (c === '}') {
      if (depth === 0) return null
      depth--
    } else if (c === '$' && depth === 0) {
      if (display) {
        // A lone `$` inside display math is not allowed (pulldown-cmark: `$$ $ $$` is text).
        return text[i + 1] === '$' ? { end: i + 2, display } : null
      }
      if (i === start || isSpace(text[i - 1])) return null
      return { end: i + 1, display }
    }
  }
  return null
}

export interface MathSpan {
  from: number
  to: number
  display: boolean
}

/**
 * All formulas in one block's inline text, left to right like pulldown-cmark: backslash escapes
 * and code spans (the leftmost of code span and formula wins) are honoured. Block structure
 * (fences, HTML, front matter) is the caller's job.
 */
export function mathSpans(text: string): MathSpan[] {
  const out: MathSpan[] = []
  for (let i = 0; i < text.length; ) {
    const c = text[i]
    if (c === '\\') {
      i += 2
    } else if (c === '`') {
      // CommonMark code span: a run of n backticks closes at the next run of exactly n.
      let n = 1
      while (text[i + n] === '`') n++
      let close = -1
      for (let j = i + n; j < text.length; ) {
        if (text[j] !== '`') {
          j++
          continue
        }
        let m = 1
        while (text[j + m] === '`') m++
        if (m === n) {
          close = j + m
          break
        }
        j += m
      }
      i = close >= 0 ? close : i + n
    } else if (c === '$') {
      const m = scanInlineMath(text, i)
      if (m) {
        out.push({ from: i, to: m.end, display: m.display })
        i = m.end
      } else {
        i++
      }
    } else {
      i++
    }
  }
  return out
}

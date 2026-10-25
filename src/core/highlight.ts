/**
 * `==text==` highlights found the way the PDF finds them: pipeline/lib/markdown.typ `marks()`
 * turns each match of `mark-re` into `<mark>…</mark>`, line by line, never in lines `skip-mask`
 * masks (that is the caller's job: the editor's parser never sees fenced code, the parity test
 * uses typography.ts skipMask). Inside a line it splits at backticks and then at `$` exactly as
 * `marks()` does, which is cruder than CommonMark on purpose: the PDF decides, and the editor
 * follows it (pipeline/tests/test-marks.sh compares both line by line).
 *
 * Known differences, where the editor does not show exactly what the PDF prints (the PDF side
 * is the broken one in most of them):
 * - an escaped `\==`: the pipeline marks it anyway;
 * - link destinations and HTML attributes: the pipeline marks inside them, the editor does not;
 * - an even number of `$` on a line or a mid-line `$$…$$`: the pipeline's `$` split differs
 *   from the editor's formula parser;
 * - table rows: the editor parses each cell alone, the pipeline splits the whole row at `$`.
 *
 * Import-free, so pipeline/tests/marks-core.mts can run it by Node's type stripping.
 */

/**
 * markdown.typ `mark-re`: the content starts and ends with a non-space, non-`=` character and
 * holds no `=`. `\s` is Unicode whitespace in both engines (JS and Rust's regex differ only in
 * U+FEFF/U+0085, which no note uses as a word gap).
 */
const MARK_RE = /==([^=\s](?:[^=]*[^=\s])?)==/gu

export interface HighlightSpan {
  from: number
  to: number
}

/**
 * Offsets of every whole `==…==` in one line (marks included), left to right. Like `marks()`:
 * the odd pieces between backticks are code and skipped; an even piece split at `$` into at
 * least three parts, odd in number, skips its odd parts (formulas, as smart-typography does).
 */
export function highlightSpans(line: string): HighlightSpan[] {
  const out: HighlightSpan[] = []
  if (!line.includes('==')) return out
  let at = 0
  line.split('`').forEach((piece, k) => {
    if (k % 2 === 0) {
      const dollars = piece.split('$')
      const formulas = dollars.length >= 3 && dollars.length % 2 === 1
      let pos = at
      dollars.forEach((part, j) => {
        if (!formulas || j % 2 === 0) {
          for (const m of part.matchAll(MARK_RE)) {
            out.push({ from: pos + m.index, to: pos + m.index + m[0].length })
          }
        }
        pos += part.length + 1
      })
    }
    at += piece.length + 1
  })
  return out
}

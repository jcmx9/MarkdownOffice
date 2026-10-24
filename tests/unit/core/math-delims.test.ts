import { describe, expect, it } from 'vitest'
import { mathSpans, scanInlineMath } from '../../../src/core/math-delims'

type Span = [from: number, to: number, display: boolean]

/** scanInlineMath at every `$` outside a span already found, honouring escapes and code spans. */
const spans = (text: string): Span[] => mathSpans(text).map((s) => [s.from, s.to, s.display])

describe('scanInlineMath / mathSpans (pulldown-cmark rules as in the bundled cmarker)', () => {
  it.each<[string, Span[]]>([
    ['$x^2$', [[0, 5, false]]],
    ['a $x$ b', [[2, 5, false]]],
    ['costs $5 and $10', []],
    ['5 $ and 10 $', []],
    ['\\$x$', []],
    ['$$x$$', [[0, 5, true]]],
    ['text $$ a + b $$ more', [[5, 16, true]]],
    ['`$x$`', []],
    // pulldown-cmark specs/math.txt cases, checked against cmarker 0.1.10
    ['Oops empty $$ expression.', []],
    ['$$$$', [[0, 4, true]]],
    ['$x $ x$', []],
    ['$$ $ $$', []],
    ['alpha$$beta$gamma$$delta', [[6, 12, false]]],
    [
      '$a$$b$',
      [
        [0, 3, false],
        [3, 6, false],
      ],
    ],
    [
      '$$a$$$b$',
      [
        [0, 5, true],
        [5, 8, false],
      ],
    ],
    [
      '$x$$$$$$y$$',
      [
        [0, 3, false],
        [3, 7, true],
        [7, 10, false],
      ],
    ],
    ['$Inline `first$ then` code', [[0, 15, false]]],
    ['`Code $first` then$ inline', []],
    ['$\\text{Hello $x$ there!}$', [[0, 25, false]]],
    ['$}{$', []],
    ['$\\}\\{$', [[0, 6, false]]],
    ['$}$2+2$', [[2, 7, false]]],
    ['${$^$$', [[2, 5, false]]],
    ['$$x$x$$', [[1, 4, false]]],
    ['$\\$$', [[0, 4, false]]],
    ['$5x + 2 =\n17$', [[0, 13, false]]],
    ['$y=x\n$', []],
    ['$\tx$', []],
    // U+00A0 is no ASCII whitespace: a formula in pulldown-cmark
    ['$ x$', [[0, 4, false]]],
    // the bundled pulldown-cmark has no digit rule yet: `$1$` is a formula before `2`
    ['$1$2$3', [[0, 3, false]]],
  ])('scans %j', (text, expected) => {
    expect(spans(text)).toEqual(expected)
  })

  it('returns the end after the closing delimiter, or null', () => {
    expect(scanInlineMath('a $x$ b', 2)).toEqual({ end: 5, display: false })
    expect(scanInlineMath('$$\na\n$$', 0)).toEqual({ end: 7, display: true })
    expect(scanInlineMath('a $x$ b', 0)).toBeNull()
    expect(scanInlineMath('\\$x$', 1)).toBeNull()
    expect(scanInlineMath('\\\\$x$', 2)).toEqual({ end: 5, display: false })
  })
})

import type { Tree } from '@lezer/common'
import { describe, expect, it } from 'vitest'
import { highlightSpans } from '../../../src/core/highlight'
import { HighlightSyntax, markdownParser } from '../../../src/core/markdown-syntax'

/** Every node of `name` as `from-to`, with its HighlightMark children for a Highlight. */
function found(tree: Tree, name: string): string[] {
  const out: string[] = []
  tree.iterate({
    enter(n) {
      if (n.name !== name) return
      const marks = n.node.getChildren('HighlightMark').map((m) => `${m.from}-${m.to}`)
      out.push(`${n.from}-${n.to}${marks.length ? ` [${marks.join(' ')}]` : ''}`)
    },
  })
  return out
}

describe('highlightSpans (markdown.typ mark-re in marks())', () => {
  it.each<[string, Array<{ from: number; to: number }>]>([
    ['a ==b c== d', [{ from: 2, to: 9 }]],
    ['==x==', [{ from: 0, to: 5 }]],
    // content starts and ends with a non-space non-`=`, and holds no `=`
    ['== x==', []],
    ['==x ==', []],
    ['==a=b==', []],
    ['====', []],
    [
      '==a== ==b==',
      [
        { from: 0, to: 5 },
        { from: 6, to: 11 },
      ],
    ],
    // the pipeline splits at backticks and at `$`, like smart-typography
    ['`==x==` ==y==', [{ from: 8, to: 13 }]],
    ['$a ==b== c$ ==d==', [{ from: 12, to: 17 }]],
    // an unclosed `$` is no formula: the whole piece counts
    ['costs $5 ==x==', [{ from: 9, to: 14 }]],
  ])('%j', (line, spans) => {
    expect(highlightSpans(line)).toEqual(spans)
  })
})

describe('HighlightSyntax', () => {
  it('is a MarkdownConfig defining Highlight and HighlightMark', () => {
    expect(HighlightSyntax.defineNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Highlight' }),
        expect.objectContaining({ name: 'HighlightMark' }),
      ]),
    )
  })

  it('parses ==y== with its two marks', () => {
    expect(found(markdownParser.parse('x ==y== z'), 'Highlight')).toEqual(['2-7 [2-4 5-7]'])
  })

  it('===x=== highlights 1-6 (the content may not hold `=`, the outer ones stay text)', () => {
    expect(found(markdownParser.parse('===x==='), 'Highlight')).toEqual(['1-6 [1-3 4-6]'])
  })

  it('never spans a line break', () => {
    expect(found(markdownParser.parse('==a\nb=='), 'Highlight')).toEqual([])
  })

  it('finds nothing inside a fenced block', () => {
    expect(found(markdownParser.parse('```\n==a==\n```'), 'Highlight')).toEqual([])
  })

  it('finds nothing inside a code span or a formula', () => {
    expect(found(markdownParser.parse('`==a==` $b ==c== d$'), 'Highlight')).toEqual([])
  })

  it('keeps emphasis inside and around it', () => {
    const tree = markdownParser.parse('**==b==** ==*c*==')
    expect(found(tree, 'Highlight')).toEqual(['2-7 [2-4 5-7]', '10-17 [10-12 15-17]'])
    expect(found(tree, 'Emphasis')).toEqual(['12-15'])
  })

  it('finds a span on a later line of a paragraph and in a quote', () => {
    expect(found(markdownParser.parse('a\nb ==c=='), 'Highlight')).toEqual(['4-9 [4-6 7-9]'])
    expect(found(markdownParser.parse('> a\n> ==b=='), 'Highlight')).toEqual(['6-11 [6-8 9-11]'])
  })
})

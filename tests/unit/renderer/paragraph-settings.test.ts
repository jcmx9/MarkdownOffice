import { describe, expect, it } from 'vitest'
import { paragraphSettings } from '../../../src/renderer/editor/paragraph-settings'

/** A stand-in for getComputedStyle: only getPropertyValue is read. */
function style(tokens: Record<string, string>): CSSStyleDeclaration {
  return { getPropertyValue: (n: string) => tokens[n] ?? '' } as unknown as CSSStyleDeclaration
}

describe('paragraphSettings', () => {
  it('defaults: justified, hyphenation follows, costs 1, lang de', () => {
    expect(paragraphSettings(style({}), undefined)).toEqual({
      justify: false,
      hyphenate: false,
      lang: 'de',
      costs: { hyphenation: 1, runt: 1 },
    })
  })
  it('hyphenate auto follows justify', () => {
    const on = paragraphSettings(
      style({ '--mdo-align': ' justify ', '--mdo-hyphenate': 'auto' }),
      'de',
    )
    expect(on.justify).toBe(true)
    expect(on.hyphenate).toBe(true)
    expect(
      paragraphSettings(style({ '--mdo-align': 'left', '--mdo-hyphenate': 'auto' }), 'de')
        .hyphenate,
    ).toBe(false)
  })
  it.each([
    ['true', 'left', true],
    ['false', 'justify', false],
    ['bogus', 'justify', true],
    ['', 'left', false],
  ])('hyphenate %s with align %s -> %s', (h, align, want) => {
    expect(
      paragraphSettings(style({ '--mdo-align': align, '--mdo-hyphenate': h }), 'de').hyphenate,
    ).toBe(want)
  })
  it.each([
    ['200%', 2],
    ['100%', 1],
    ['50.5%', 0.505],
    ['0%', 0],
    ['abc', 1],
    ['200', 1],
    ['-5%', 1],
    ['', 1],
  ])('cost %s -> %s', (v, want) => {
    const s = paragraphSettings(style({ '--mdo-runt-cost': v, '--mdo-hyphenation-cost': v }), 'de')
    expect(s.costs.runt).toBeCloseTo(want)
    expect(s.costs.hyphenation).toBeCloseTo(want)
  })
  it.each([
    ['EN-US', 'en'],
    ['de_AT', 'de'],
    ['fr', 'fr'],
    ['', 'de'],
    [undefined, 'de'],
  ])('lang %s -> %s', (l, want) => {
    expect(paragraphSettings(style({}), l).lang).toBe(want)
  })
})

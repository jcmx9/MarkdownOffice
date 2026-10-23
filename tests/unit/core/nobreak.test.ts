import { describe, expect, it } from 'vitest'
import { nobreakRanges } from '../../../src/core/nobreak'
import { MEMO_PREVIEW } from '../../../src/core/preview-spec'

const found = (text: string, nb: Parameters<typeof nobreakRanges>[1]) =>
  nobreakRanges(text, nb).map((r) => text.slice(r.from, r.to))

describe('nobreakRanges', () => {
  it('finds literal words', () => {
    expect(found('Siehe z. B. hier und u. a. dort', MEMO_PREVIEW.nobreak)).toEqual([
      'z. B.',
      'u. a.',
    ])
  })

  // Like memo.typ's `[0-9] (…)`, the range starts at the last digit: a number is one word anyway.
  it('finds digit + unit, with letter units ending at a word boundary', () => {
    const nb = { words: [], units: ['mm', '%', '€', 'm'] }
    expect(found('5 mm, 20 % und 3 €', nb)).toEqual(['5 mm', '0 %', '3 €'])
    expect(found('5 Meter, 5 mmx, 5 m.', nb)).toEqual(['5 m'])
  })

  it('does not match a unit without a digit before the space', () => {
    expect(found('x mm', { words: [], units: ['mm'] })).toEqual([])
  })

  it('escapes regex characters in literals', () => {
    const nb = { words: ['a.b', '(x)'], units: ['$', '°C', '.'] }
    expect(found('a.b axb (x) 5 $ 7 °C 1 .', nb)).toEqual(['a.b', '(x)', '5 $', '7 °C', '1 .'])
  })

  it('returns [] for an empty spec and empty text', () => {
    expect(nobreakRanges('5 mm z. B.', { words: [], units: [] })).toEqual([])
    expect(nobreakRanges('', MEMO_PREVIEW.nobreak)).toEqual([])
  })

  it('returns sorted, non-overlapping ranges', () => {
    const nb = { words: ['5 mm', 'mm x'], units: ['mm'] }
    const r = nobreakRanges('a 5 mm x 5 mm', nb)
    for (let i = 1; i < r.length; i++) expect(r[i]?.from).toBeGreaterThanOrEqual(r[i - 1]?.to ?? 0)
    expect(r.length).toBeGreaterThan(0)
  })

  it('ignores empty entries instead of matching everywhere', () => {
    expect(nobreakRanges('abc', { words: [''], units: [''] })).toEqual([])
  })

  it('stays fast on 10 000 characters with 200 words', () => {
    const words = Array.from({ length: 200 }, (_, i) => `w${i}. x`)
    const text = `${'Lorem ipsum dolor 5 mm w199. x sit amet. '.repeat(250)}`.slice(0, 10_000)
    const t0 = performance.now()
    const r = nobreakRanges(text, { words, units: MEMO_PREVIEW.nobreak.units })
    expect(performance.now() - t0).toBeLessThan(50)
    expect(r.length).toBeGreaterThan(100)
  })

  it('does not slow down on a long run of near-matches', () => {
    const text = '1 '.repeat(5000)
    const t0 = performance.now()
    nobreakRanges(text, { words: ['1 1 1 1 2'], units: ['mm'] })
    expect(performance.now() - t0).toBeLessThan(50)
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HYPHEN_MIN, hyphenPoints, loadTrie } from '../../../../src/core/paragraph/hyphenate'

interface Case {
  word: string
  parts: string[]
}

const read = (p: string): Buffer => readFileSync(new URL(`../../../../${p}`, import.meta.url))
const fixture = (lang: string): Case[] =>
  JSON.parse(read(`tests/fixtures/hyphenation/${lang}.json`).toString('utf8')) as Case[]
const trieOf = (lang: 'de' | 'en') => loadTrie(new Uint8Array(read(`vendor/hypher/${lang}.bin`)))

function split(word: string, points: number[]): string[] {
  const cuts = [0, ...points, word.length]
  return cuts.slice(1).map((end, i) => word.slice(cuts[i], end))
}

describe('hyphenate (hypher 0.1.5 port)', () => {
  for (const lang of ['de', 'en'] as const) {
    it(`matches hypher 0.1.5 for every ${lang} fixture word`, () => {
      const trie = trieOf(lang)
      const cases = fixture(lang)
      expect(cases.length).toBeGreaterThan(100)
      for (const { word, parts } of cases) {
        expect({ word, parts: split(word, hyphenPoints(word, trie, HYPHEN_MIN[lang])) }).toEqual({
          word,
          parts,
        })
      }
    })
  }

  it('returns no points for words shorter than left+right minimum', () => {
    const de = trieOf('de')
    expect(hyphenPoints('Haus', de, HYPHEN_MIN.de)).toEqual([])
    expect(hyphenPoints('', de, HYPHEN_MIN.de)).toEqual([])
    expect(hyphenPoints('a', de, HYPHEN_MIN.de)).toEqual([])
    expect(hyphenPoints('Silbentrennung', de, { left: 20, right: 20 })).toEqual([])
  })

  it('handles umlauts and ß (UTF-8 multi-byte)', () => {
    const de = trieOf('de')
    const cases = fixture('de').filter((c) => /[äöüÄÖÜß]/.test(c.word) && c.parts.length > 1)
    expect(cases.length).toBeGreaterThan(20)
    for (const { word, parts } of cases) {
      expect(split(word, hyphenPoints(word, de, HYPHEN_MIN.de))).toEqual(parts)
    }
  })

  it("agrees with hypher's own unit tests", () => {
    const de = trieOf('de')
    const hy = (w: string) => split(w, hyphenPoints(w, de, HYPHEN_MIN.de)).join('-')
    expect(hy('Eingabeaufforderung')).toBe('Ein-ga-be-auf-for-de-rung')
    expect(hy('Tomate')).toBe('To-ma-te')
    expect(hy('Apfel')).toBe('Ap-fel')
  })

  it('loadTrie rejects a truncated buffer', () => {
    const bytes = new Uint8Array(read('vendor/hypher/de.bin'))
    expect(() => loadTrie(bytes.slice(0, bytes.length >> 1))).toThrow()
    expect(() => loadTrie(bytes.slice(0, 3))).toThrow()
  })
})

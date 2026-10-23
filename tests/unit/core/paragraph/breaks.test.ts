// @vitest-environment happy-dom
// happy-dom on purpose: the renderer imports `linebreak`, so its inlined trie must load without `fs`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type BreakPoint, breakPoints } from '../../../../src/core/paragraph/breaks'
import { loadTrie } from '../../../../src/core/paragraph/hyphenate'

// Under happy-dom `import.meta.url` is not a file URL, so resolve from the project root (Vitest's cwd).
const trieOf = (lang: 'de' | 'en') =>
  loadTrie(new Uint8Array(readFileSync(join(process.cwd(), `vendor/hypher/${lang}.bin`))))
const tries = { de: trieOf('de'), en: trieOf('en') }
const de = { hyphenate: true, lang: 'de', tries }

/** `text` with a `|` at every normal break, `-` at a hyphen and `~` at a soft break. */
function mark(text: string, points: BreakPoint[]): string {
  let out = ''
  let at = 0
  for (const p of points) {
    out += text.slice(at, p.index) + { normal: '|', hyphen: '-', soft: '~' }[p.kind]
    at = p.index
  }
  return out + text.slice(at)
}

describe('breakPoints', () => {
  it('breaks after spaces', () => {
    expect(mark('Es ist gut', breakPoints('Es ist gut', de))).toBe('Es |ist |gut')
  })

  it('breaks after a hard hyphen inside a compound', () => {
    const text = 'Mess-Ergebnis'
    expect(breakPoints(text, { ...de, hyphenate: false })).toEqual([{ index: 5, kind: 'normal' }])
  })

  it('hyphenates each compound part separately', () => {
    // hypher 0.1.5 (de): Er-geb-nis; "Mess" alone has no break, the part minimums apply per part.
    expect(mark('Mess-Ergebnis', breakPoints('Mess-Ergebnis', de))).toBe('Mess-|Er-geb-nis')
  })

  it('does not hyphenate words with digits or apostrophes', () => {
    const text = 'B2B geht’s Zusammenarbeit'
    const marked = mark(text, breakPoints(text, de))
    expect(marked.startsWith('B2B |geht’s |')).toBe(true)
    expect(marked).toContain('Zu-sam-men-ar-beit')
  })

  it('soft hyphen yields kind soft', () => {
    const text = 'Trenn­ung'
    expect(breakPoints(text, de)).toEqual([{ index: 6, kind: 'soft' }])
  })

  it('nbsp is not a break', () => {
    expect(breakPoints('a b c', de)).toEqual([{ index: 4, kind: 'normal' }])
  })

  it('never splits a surrogate pair', () => {
    const text = 'x 😀😀😀 y'
    const points = breakPoints(text, de)
    expect(points.length).toBeGreaterThan(0)
    for (const { index } of points) {
      const code = text.charCodeAt(index)
      expect(code >= 0xdc00 && code <= 0xdfff).toBe(false)
    }
  })

  it('unknown lang has no hyphen points', () => {
    const text = 'Zusammenarbeit Kommunikation'
    const points = breakPoints(text, { ...de, lang: 'fr' })
    expect(points).toEqual([{ index: 15, kind: 'normal' }])
  })

  it('maps regional tags to their language', () => {
    const text = 'Zusammenarbeit'
    expect(mark(text, breakPoints(text, { ...de, lang: 'de-AT' }))).toBe('Zu-sam-men-ar-beit')
    expect(breakPoints(text, { ...de, lang: 'en-GB' })).not.toEqual(breakPoints(text, de))
  })

  it('hyphenate false gives only normal points', () => {
    const text = 'Zusammenarbeit ist Kommunikation'
    const points = breakPoints(text, { ...de, hyphenate: false })
    expect(points.every((p) => p.kind === 'normal')).toBe(true)
    expect(points.map((p) => p.index)).toEqual([15, 19])
  })

  it('has no break at 0 or at the end, sorted without duplicates', () => {
    const text = ' Zusammenarbeit '
    const idx = breakPoints(text, de).map((p) => p.index)
    expect(idx).not.toContain(0)
    expect(idx).not.toContain(text.length)
    expect([...new Set(idx)].sort((a, b) => a - b)).toEqual(idx)
    expect(breakPoints('', de)).toEqual([])
  })

  describe('URL rule (Typst linebreak_link)', () => {
    it('breaks a link only at class changes, never inside a word of it', () => {
      const text = 'Link https://example.com/path?x=1 hier'
      // UAX #14 gives "https://" its break, then Typst's rule takes over until the link ends:
      // before an alphanumeric run that follows punctuation, and on letter/digit changes.
      expect(mark(text, breakPoints(text, de))).toBe(
        'Link |https://|example.|com/|path?|x=|1 |hier',
      )
    })

    it('treats text starting with www. as a link', () => {
      const text = 'www.example.org/a2b'
      expect(mark(text, breakPoints(text, de))).toBe('www.|example.|org/|a|2|b')
    })

    it('breaks between two punctuation chars but never after ( or [', () => {
      const text = 'https://x.org//wiki/(Foo)'
      expect(mark(text, breakPoints(text, de))).toBe('https://|x.|org/|/|wiki/|(Foo)')
    })

    it('allows a break after every char of a piece of 16 or more bytes', () => {
      const text = 'https://x.org/abcdefghijklmnopq/x'
      const marked = mark(text, breakPoints(text, de))
      expect(marked).toBe('https://|x.|org/|a|b|c|d|e|f|g|h|i|j|k|l|m|n|o|p|q|/|x')
    })

    it('does not hyphenate inside a link', () => {
      const text = 'https://zusammenarbeit.de'
      expect(breakPoints(text, de).every((p) => p.kind === 'normal')).toBe(true)
    })
  })
})

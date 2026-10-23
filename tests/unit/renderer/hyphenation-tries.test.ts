import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HYPHEN_MIN, hyphenPoints, loadTrie } from '../../../src/core/paragraph/hyphenate'
import { decodeDataUrl, requestTrie, trieFor } from '../../../src/renderer/editor/hyphenation-tries'

const vendor = (f: string) => readFileSync(join(__dirname, '..', '..', '..', 'vendor', 'hypher', f))

describe('hyphenation tries', () => {
  // hypher 0.1.5 exactly (what Typst 0.15.0 locks): a later tag changed the German patterns and
  // would break lines differently from the PDF. The README lists the same sums.
  it.each([
    ['de.bin', 'b2aa8bb33a4e54a409fc61f47643210d03b5493e4ef1059dac946b00730ed023'],
    ['en.bin', 'be2bcb386cb777a191813f68b995d0c22fbf30783ac52a0ad2489c8ebd7fd354'],
  ])('vendor/hypher/%s is the pinned trie', (file, sha256) => {
    expect(createHash('sha256').update(vendor(file)).digest('hex')).toBe(sha256)
    expect(vendor('README.md').toString('utf8')).toContain(`\`${sha256}\``)
  })
  it('decodes a base64 data URL byte for byte', () => {
    expect([...decodeDataUrl('data:application/octet-stream;base64,AAH/gA==')]).toEqual([
      0, 1, 255, 128,
    ])
    expect(() => decodeDataUrl('data:text/plain,abc')).toThrow()
  })
  it('is not there before it was requested', () => {
    expect(trieFor('en')).toBeUndefined()
  })
  it('loads the shipped bytes once and caches the decoded trie', async () => {
    const a = requestTrie('de')
    const b = requestTrie('de')
    expect(b).toBe(a)
    const trie = await a
    expect(trieFor('de')).toBe(trie)
    expect(trie.data).toEqual(new Uint8Array(vendor('de.bin')))
    // Same result as the trie decoded straight from the vendored file.
    const direct = loadTrie(new Uint8Array(vendor('de.bin')))
    expect(hyphenPoints('Silbentrennung', trie, HYPHEN_MIN.de)).toEqual(
      hyphenPoints('Silbentrennung', direct, HYPHEN_MIN.de),
    )
  })
  it('loads en on its own', async () => {
    const trie = await requestTrie('en')
    expect(trie.data.length).toBe(vendor('en.bin').length)
  })
})

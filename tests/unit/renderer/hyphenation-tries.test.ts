import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HYPHEN_MIN, hyphenPoints, loadTrie } from '../../../src/core/paragraph/hyphenate'
import { decodeDataUrl, requestTrie, trieFor } from '../../../src/renderer/editor/hyphenation-tries'

const vendor = (f: string) => readFileSync(join(__dirname, '..', '..', '..', 'vendor', 'hypher', f))

describe('hyphenation tries', () => {
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

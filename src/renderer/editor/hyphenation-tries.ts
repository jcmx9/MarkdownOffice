/**
 * hypher's hyphenation tries for the preview, loaded on first use per language.
 *
 * The bytes ship unchanged (vendor/hypher, byte-identical to hypher v0.1.5, so the preview
 * hyphenates exactly where Typst does). Imported with `?inline` (a base64 data URL in its own
 * chunk, see `assetsInclude` in electron.vite.config.ts): no file access from the sandboxed
 * renderer, and a note in English never loads the 190 KB German trie. Each trie is decoded once
 * and shared by every view.
 */
import { loadTrie, type Trie } from '../../core/paragraph/hyphenate'

export type TrieLang = 'de' | 'en'

const sources: Record<TrieLang, () => Promise<{ default: string }>> = {
  de: () => import('../../../vendor/hypher/de.bin?inline'),
  en: () => import('../../../vendor/hypher/en.bin?inline'),
}

const loaded = new Map<TrieLang, Trie>()
const pending = new Map<TrieLang, Promise<Trie>>()

/** The bytes of a `data:…;base64,` URL (what Vite's `?inline` yields for a binary file). */
export function decodeDataUrl(url: string): Uint8Array {
  const comma = url.indexOf(',')
  if (!url.startsWith('data:') || comma < 0 || !url.slice(0, comma).endsWith(';base64')) {
    throw new Error('hyphenation trie: not a base64 data URL')
  }
  const bin = atob(url.slice(comma + 1))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** The decoded trie if it has been loaded; undefined until `requestTrie` resolved. */
export function trieFor(lang: TrieLang): Trie | undefined {
  return loaded.get(lang)
}

/** Loads and decodes the trie once; later calls share the same promise. */
export function requestTrie(lang: TrieLang): Promise<Trie> {
  let p = pending.get(lang)
  if (!p) {
    p = sources[lang]().then((m) => {
      const trie = loadTrie(decodeDataUrl(m.default))
      loaded.set(lang, trie)
      return trie
    })
    // A failed load may be retried (the next set pass asks again).
    p.catch(() => pending.delete(lang))
    pending.set(lang, p)
  }
  return p
}

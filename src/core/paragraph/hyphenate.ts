/**
 * Hyphenation exactly like Typst 0.15.0, which calls hypher 0.1.5 (`hyphenate(word, lang)`).
 * This is a port of hypher's lookup (`src/lib.rs`, MIT OR Apache-2.0, see vendor/hypher/): the same
 * trie bytes, walked over the UTF-8 bytes of the lowercased, dotted word, so the preview breaks
 * words where the PDF does. Another Liang implementation or newer patterns would hyphenate some
 * words differently and move line breaks, which defeats the point.
 *
 * Changed from the original: operates on a JS string and returns UTF-16 indices instead of
 * returning `&str` syllables.
 */

export interface Trie {
  readonly data: Uint8Array
  readonly root: number
}

/** hypher's default bounds per language (`Lang::bounds`): letters kept before / after a break. */
export const HYPHEN_MIN: Record<'de' | 'en', { left: number; right: number }> = {
  de: { left: 2, right: 2 },
  en: { left: 2, right: 3 },
}

interface Node {
  stride: number
  count: number
  levelsAt: number
  levelsLen: number
  transAt: number
  targetsAt: number
}

function byteAt(data: Uint8Array | number[], i: number): number {
  const b = data[i]
  // A truncated or foreign file must fail loudly, not hyphenate silently wrong.
  if (b === undefined) throw new RangeError(`hyphenation trie: byte ${i} out of range`)
  return b
}

function readNode(data: Uint8Array, addr: number): Node {
  let pos = addr
  const b0 = byteAt(data, pos++)
  const hasLevels = b0 >> 7 !== 0
  const stride = (b0 >> 5) & 3
  let count = b0 & 31
  // 31 is the escape for "the real count follows".
  if (count === 31) count = byteAt(data, pos++)
  let levelsAt = 0
  let levelsLen = 0
  if (hasLevels) {
    const hi = byteAt(data, pos)
    const lo = byteAt(data, pos + 1)
    levelsAt = (hi << 4) | (lo >> 4)
    levelsLen = lo & 15
    pos += 2
    byteAt(data, levelsAt + levelsLen - 1)
  }
  const transAt = pos
  const targetsAt = pos + count
  if (count > 0) byteAt(data, targetsAt + stride * count - 1)
  return { stride, count, levelsAt, levelsLen, transAt, targetsAt }
}

/** Target delta as hypher's `from_be_bytes`: i8, i16 or u24 - 2^23. */
function readDelta(data: Uint8Array, at: number, stride: number): number {
  if (stride === 1) return (byteAt(data, at) << 24) >> 24
  if (stride === 2) return (((byteAt(data, at) << 8) | byteAt(data, at + 1)) << 16) >> 16
  if (stride === 3) {
    return (byteAt(data, at) << 16) + (byteAt(data, at + 1) << 8) + byteAt(data, at + 2) - (1 << 23)
  }
  throw new RangeError('hyphenation trie: invalid stride')
}

function transition(data: Uint8Array, addr: number, node: Node, b: number): number | null {
  for (let i = 0; i < node.count; i++) {
    if (data[node.transAt + i] === b) {
      return addr + readDelta(data, node.targetsAt + node.stride * i, node.stride)
    }
  }
  return null
}

/** Reads hypher's trie format (`tries/*.bin`); throws on a buffer that cannot be one. */
export function loadTrie(bytes: Uint8Array): Trie {
  if (bytes.length < 5) throw new RangeError('hyphenation trie: buffer too short')
  const root =
    ((byteAt(bytes, 0) << 24) |
      (byteAt(bytes, 1) << 16) |
      (byteAt(bytes, 2) << 8) |
      byteAt(bytes, 3)) >>>
    0
  readNode(bytes, root)
  return { data: bytes, root }
}

/** UTF-8 bytes of the lowercased word between dots, plus the UTF-16 index of every char start. */
function dotted(word: string): {
  bytes: number[]
  starts: Map<number, number>
  charBytes: number[]
} {
  const bytes: number[] = [0x2e]
  const starts = new Map<number, number>()
  const charBytes: number[] = []
  let utf16 = 0
  for (const original of word) {
    let c = original
    // hypher lowercases a char only if the result is one char of the same UTF-8 length (so byte
    // offsets stay those of the original word), e.g. not İ, which lowercases to two chars.
    const lower = c.toLowerCase()
    if (
      [...lower].length === 1 &&
      utf8Len(lower.codePointAt(0) as number) === utf8Len(c.codePointAt(0) as number)
    ) {
      c = lower
    }
    starts.set(bytes.length - 1, utf16)
    const cp = c.codePointAt(0) as number
    pushUtf8(bytes, cp)
    charBytes.push(utf8Len(cp))
    utf16 += original.length
  }
  starts.set(bytes.length - 1, utf16)
  bytes.push(0x2e)
  return { bytes, starts, charBytes }
}

function utf8Len(cp: number): number {
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
}

function pushUtf8(out: number[], cp: number): void {
  if (cp < 0x80) out.push(cp)
  else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63))
  else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
  else
    out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
}

/**
 * UTF-16 indices `i` (0 < i < word.length) where a hyphen may go between `word[i-1]` and
 * `word[i]`, under the given left/right minimums (in code points, like hypher).
 */
export function hyphenPoints(
  word: string,
  trie: Trie,
  min: { left: number; right: number },
): number[] {
  const { bytes, starts, charBytes } = dotted(word)
  const wordLen = bytes.length - 2
  if (wordLen < 2) return []
  const left = Math.max(min.left, 1)
  const right = Math.max(min.right, 1)
  const minIdx = 1 + charBytes.slice(0, left).reduce((a, b) => a + b, 0)
  const maxIdx = 1 + wordLen - charBytes.slice(-right).reduce((a, b) => a + b, 0)
  const levels = new Uint8Array(wordLen - 1)
  const { data } = trie

  for (let start = 0; start < bytes.length; start++) {
    // Only start on char boundaries (not on UTF-8 continuation bytes).
    if ((byteAt(bytes, start) << 24) >> 24 < -0x40) continue
    let addr = trie.root
    let node = readNode(data, addr)
    for (let k = start; k < bytes.length; k++) {
      const next = transition(data, addr, node, byteAt(bytes, k))
      if (next === null) break
      addr = next
      node = readNode(data, addr)
      let offset = 0
      for (let j = 0; j < node.levelsLen; j++) {
        const packed = byteAt(data, node.levelsAt + j)
        offset += Math.floor(packed / 10)
        const split = start + offset
        if (split >= minIdx && split <= maxIdx) {
          const slot = split - 2
          levels[slot] = Math.max(levels[slot] ?? 0, packed % 10)
        }
      }
    }
  }

  const points: number[] = []
  for (let i = 0; i < levels.length; i++) {
    if ((levels[i] ?? 0) % 2 === 1) {
      const at = starts.get(i + 1)
      if (at !== undefined) points.push(at)
    }
  }
  return points
}

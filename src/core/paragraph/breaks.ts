/**
 * Line break opportunities exactly where Typst 0.15.0 finds them
 * (`crates/typst-layout/src/inline/linebreak.rs`, fn `breakpoints`), so the preview can only
 * break a paragraph where the PDF could:
 *
 * - UAX #14 opportunities. Typst uses ICU4X; the browser has no line segmenter (`Intl.Segmenter`
 *   stops at words), so `linebreak` 1.1.0 stands in. It implements Unicode 13, ICU4X 2.2 a newer
 *   version, so rare classes (German quotes „“, « ») may differ.
 * - Typst's own rule for links, which replaces UAX #14 inside a URL (fn `linebreak_link`).
 * - Hyphenation points inside purely alphabetic words (fn `hyphenations`), via the hypher port.
 *
 * Indices are UTF-16 offsets into `text`; the Rust code works in UTF-8 bytes, which only matters
 * for the link rule's 16-byte threshold, and links are ASCII there (byte = UTF-16 unit).
 */
import LineBreaker from 'linebreak'
import { HYPHEN_MIN, hyphenPoints, type Trie } from './hyphenate'

/** `soft`: the break follows a soft hyphen (U+00AD), so the line gets a hyphen glyph. */
export type BreakKind = 'normal' | 'hyphen' | 'soft'

export interface BreakPoint {
  /** UTF-16 offset in the display string where the next line would start. */
  index: number
  kind: BreakKind
}

export interface BreakOptions {
  /** Typst's `text.hyphenate` as resolved for the paragraph (auto follows `par.justify`). */
  hyphenate: boolean
  /** BCP 47 tag of the text; only the primary subtag counts. */
  lang: string
  tries: Partial<Record<'de' | 'en', Trie>>
}

const SOFT_HYPHEN = '­'

// Rust's `char::is_alphabetic` is the Unicode `Alphabetic` property (a bit wider than \p{L}).
const ALPHABETIC = /^\p{Alphabetic}+$/u

// UAX #29 word bounds like `unicode-segmentation`'s `split_word_bounds`; a neutral locale, because
// that crate has no locale tailoring.
const words = new Intl.Segmenter('und', { granularity: 'word' })

/**
 * Typst passes the language's two-letter code to `hypher::Lang::from_iso` (fn `lang_at`); the
 * region (de-AT, de-CH) is ignored. Only the languages we ship a trie for can hyphenate.
 */
function hyphenLang(lang: string): 'de' | 'en' | null {
  const primary = lang.split(/[-_]/)[0]?.toLowerCase()
  return primary === 'de' || primary === 'en' ? primary : null
}

/**
 * Typst's `link_prefix` (`crates/typst-syntax/src/lexer.rs`): the run of URL chars from the start,
 * with balanced brackets, minus trailing punctuation that is likely part of the sentence.
 */
function linkPrefix(text: string): string {
  const brackets: string[] = []
  let end = 0
  for (; end < text.length; end++) {
    const c = text[end] as string
    if (/[0-9a-zA-Z!#$%&*+,\-./:;=?@_~']/.test(c)) continue
    if (c === '[' || c === '(') {
      brackets.push(c)
      continue
    }
    if (c === ']' && brackets.pop() === '[') continue
    if (c === ')' && brackets.pop() === '(') continue
    break
  }
  while (end > 0 && /[!,.:;?']/.test(text[end - 1] as string)) end--
  return text.slice(0, end)
}

type LinkClass = 'alphabetic' | 'digit' | 'open' | 'other'

function linkClass(c: string): LinkClass {
  if (/\p{Alphabetic}/u.test(c)) return 'alphabetic'
  if (/\p{N}/u.test(c)) return 'digit'
  if (c === '(' || c === '[') return 'open'
  return 'other'
}

/**
 * Typst's `linebreak_link`: UAX #14 breaks URLs badly, so inside a link a break goes between two
 * "other" chars and on every letter/digit change, never after `(` or `[`. A piece of 16 bytes or
 * more (a hash, say) may break after every char. Offsets are relative to `link`.
 */
function linkBreaks(link: string, emit: (offset: number) => void): void {
  let offset = 0
  let prev: LinkClass = 'other'
  for (let end = 0; end < link.length; end++) {
    const cls = linkClass(link[end] as string)
    const change = cls === 'other' ? prev === 'other' : cls !== prev
    if (end > 0 && prev !== 'open' && change) {
      if (end - offset < 16) {
        offset = end
        emit(offset)
      } else {
        while (offset < end) emit(++offset)
      }
    }
    prev = cls
  }
}

/** All break opportunities in `text`, sorted, without duplicates, never at 0 or `text.length`. */
export function breakPoints(text: string, opts: BreakOptions): BreakPoint[] {
  const out: BreakPoint[] = []
  if (text.length === 0) return out

  const lang = hyphenLang(opts.lang)
  const trie = lang ? opts.tries[lang] : undefined
  // hypher's per-language minimums, counted within each word segment (so per compound part).
  const hyph = opts.hyphenate && lang && trie ? { trie, min: HYPHEN_MIN[lang] } : null

  // linebreak's iterator yields in order; collected so the link rule can skip ahead like Typst's
  // peekable ICU iterator.
  const uax: number[] = []
  const breaker = new LineBreaker(text)
  for (let b = breaker.nextBreak(); b; b = breaker.nextBreak()) uax.push(b.position)

  let last = 0
  let i = 0
  for (;;) {
    // Typst checks for a link at every previous break: after "://" or before "www." (fn `breakpoints`).
    if (text.endsWith('://', last) || text.startsWith('www.', last)) {
      const link = linkPrefix(text.slice(last))
      const base = last
      linkBreaks(link, (o) => out.push({ index: base + o, kind: 'normal' }))
      last += link.length
      while (i < uax.length && (uax[i] as number) < last) i++
    }

    const point = uax[i++]
    if (point === undefined) break
    // ICU4X reports offset 0, Typst drops it (no char before it).
    if (point === 0) continue

    // Hyphenate the alphabetic word segments between the last and this break (fn `hyphenations`).
    // Typst also drops hyphen points after a GL/WJ/ZWJ char; none of those is alphabetic, so that
    // filter never fires here. Typst's special case for a combining mark before U+FFFC (inline
    // objects) is not ported either: the display string has no object replacement chars.
    if (hyph && last < point) {
      for (const { segment, index } of words.segment(text.slice(last, point))) {
        if (!ALPHABETIC.test(segment)) continue
        for (const h of hyphenPoints(segment, hyph.trie, hyph.min)) {
          out.push({ index: last + index + h, kind: 'hyphen' })
        }
      }
    }

    // The end of the text is Typst's final Mandatory break, not an opportunity to choose.
    if (point < text.length) {
      // A soft hyphen is a Normal break in Typst, but the line then ends in a visible hyphen.
      out.push({ index: point, kind: text[point - 1] === SOFT_HYPHEN ? 'soft' : 'normal' })
    }
    last = point
  }

  out.sort((a, b) => a.index - b.index)
  return out.filter((p, k) => k === 0 || p.index !== (out[k - 1] as BreakPoint).index)
}

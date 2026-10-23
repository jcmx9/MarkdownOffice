import type { PreviewSpec } from './preview-spec'

/**
 * Where the preview must not break a line, as a set describes it (`nobreak:` in
 * `.preview.yaml`, mirroring memo.typ's no-break-space show rules). The ranges are for a
 * `white-space: nowrap` decoration, so the note's text stays byte-exact (no U+00A0 inserted).
 * Only literals from the set are used, escaped into one RegExp: a set file can never bring its own
 * pattern, so there is no ReDoS surface in the editor.
 */

const REGEX_SYNTAX_RE = /[\\^$.*+?()[\]{}|/]/g
const escapeRe = (s: string): string => s.replace(REGEX_SYNTAX_RE, '\\$&')
const LETTER_END_RE = /[\p{L}\p{N}_]$/u

// One compiled RegExp per spec object (the renderer keeps the same spec while the note is typed).
const compiled = new WeakMap<object, RegExp | null>()

function compile(nb: PreviewSpec['nobreak']): RegExp | null {
  // Longest first, so `i. d. R.` wins over a shorter entry that starts the same way.
  const words = nb.words.filter((w) => w !== '').sort((a, b) => b.length - a.length)
  const units = nb.units
    .filter((u) => u !== '')
    // Letter units end at a word boundary like memo.typ's `\b` (no hit in "5 Meter" for `m`);
    // symbol units (`%`, `€`) need none. Unicode-aware, `\b` alone knows only ASCII.
    .map((u) => escapeRe(u) + (LETTER_END_RE.test(u) ? '(?![\\p{L}\\p{N}_])' : ''))
  const parts = words.map(escapeRe)
  if (units.length > 0) parts.push(`[0-9] (?:${units.join('|')})`)
  return parts.length > 0 ? new RegExp(parts.join('|'), 'gu') : null
}

/** Sorted, non-overlapping ranges of `text` that should not break across lines. */
export function nobreakRanges(
  text: string,
  nb: PreviewSpec['nobreak'],
): Array<{ from: number; to: number }> {
  let re = compiled.get(nb)
  if (re === undefined) {
    re = compile(nb)
    compiled.set(nb, re)
  }
  if (re === null) return []
  const out: Array<{ from: number; to: number }> = []
  for (const m of text.matchAll(re)) out.push({ from: m.index, to: m.index + m[0].length })
  return out
}

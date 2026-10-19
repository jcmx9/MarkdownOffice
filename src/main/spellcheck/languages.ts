/**
 * One dictionary as Markdown Office knows it (Windows/Linux, Hunspell):
 * - `code`: the language code handed to `session.setSpellCheckerLanguages` (an entry of
 *   Chromium's supported-language list, so Electron never throws on it);
 * - `file`: the exact file name Chromium opens in <userData>/Dictionaries for that code;
 * - `name`: the German display name for the „Wörterbuch fehlt – laden?“ notice.
 * The dictionary repo publishes the same shape as `dictionaries.json`.
 */
export interface DictionaryInfo {
  code: string
  file: string
  name: string
}

/**
 * A dictionary code Markdown Office accepts (from the renderer and from dictionaries.json):
 * `nl`, `de-DE`. Longer Chromium codes (`en-GB-oxendict`, `es-419`) are not offered.
 */
export const CODE_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/

/**
 * The verified built-in table, used until a release's dictionaries.json has been fetched (and
 * for every code that table also lists, see mergeTables). Source: Chromium 152.0.7977.149
 * (Electron 44.7.2), components/spellcheck/common/spellcheck_common.cc —
 * kSupportedSpellCheckerLanguages maps a code to its language-region (`nl` → `nl-NL`) and
 * GetVersionedFileName appends the version (`-3-0`, en-* `-10-1`, tr-TR `-4-0`).
 * Region-less codes therefore open a file WITH region: `nl` → `nl-NL-3-0.bdic`.
 * An Electron update may change these names; the e2e "no dictionary download" test fails then.
 */
export const BUILTIN_DICTIONARIES: readonly DictionaryInfo[] = [
  { code: 'de-DE', file: 'de-DE-3-0.bdic', name: 'Deutsch' },
  { code: 'en-US', file: 'en-US-10-1.bdic', name: 'Englisch' },
  { code: 'fr-FR', file: 'fr-FR-3-0.bdic', name: 'Französisch' },
  { code: 'es-ES', file: 'es-ES-3-0.bdic', name: 'Spanisch' },
  { code: 'it-IT', file: 'it-IT-3-0.bdic', name: 'Italienisch' },
  { code: 'pt-BR', file: 'pt-BR-3-0.bdic', name: 'Portugiesisch' },
  { code: 'nl', file: 'nl-NL-3-0.bdic', name: 'Niederländisch' },
  { code: 'sv', file: 'sv-SE-3-0.bdic', name: 'Schwedisch' },
  { code: 'da', file: 'da-DK-3-0.bdic', name: 'Dänisch' },
  { code: 'nb', file: 'nb-NO-3-0.bdic', name: 'Norwegisch' },
  { code: 'pl', file: 'pl-PL-3-0.bdic', name: 'Polnisch' },
  { code: 'cs', file: 'cs-CZ-3-0.bdic', name: 'Tschechisch' },
  { code: 'ru', file: 'ru-RU-3-0.bdic', name: 'Russisch' },
  { code: 'tr', file: 'tr-TR-4-0.bdic', name: 'Türkisch' },
]

/** Language part → the code a region-less `lang:` (or a system language) uses (de → de-DE). */
const MAIN: Record<string, string> = Object.fromEntries(
  BUILTIN_DICTIONARIES.map((d) => [d.code.slice(0, 2).toLowerCase(), d.code]),
)

/**
 * The table in effect: the release's entries (what the repo offers), where a code the built-in
 * table knows keeps the built-in file name and German name (verified against the running
 * Chromium; a release may name languages in English). Without a release table: the built-in one.
 */
export function mergeTables(release: readonly DictionaryInfo[] | null): DictionaryInfo[] {
  if (!release || release.length === 0) return [...BUILTIN_DICTIONARIES]
  return release.map((r) => BUILTIN_DICTIONARIES.find((b) => b.code === r.code) ?? r)
}

function match(tag: string, available: readonly DictionaryInfo[]): DictionaryInfo | null {
  // System languages arrive as de_DE on some Linux setups: treat '_' like '-'.
  const t = tag.trim().replace(/_/g, '-')
  if (!t) return null
  const exact = available.find((a) => a.code.toLowerCase() === t.toLowerCase())
  if (exact) return exact
  const main = MAIN[t.slice(0, 2).toLowerCase()]
  const lang = t.split('-')[0]?.toLowerCase()
  // A main variant first (de-AT → de-DE); else a region-less code of a release-only language.
  return (
    available.find((a) => a.code === main) ??
    available.find((a) => a.code.toLowerCase() === lang) ??
    null
  )
}

/**
 * The dictionary for the shown note (Windows/Linux): `lang:` of the note, else the first system
 * language that has a dictionary. Region-less codes take the main variant (de → de-DE).
 * An explicit but unknown `lang:` yields null and is never overridden by the system language.
 */
export function dictionaryFor(
  lang: string,
  system: readonly string[],
  available: readonly DictionaryInfo[],
): { code: string; name: string } | null {
  const d = lang.trim()
    ? match(lang, available)
    : (system.map((s) => match(s, available)).find((c) => c !== null) ?? null)
  return d ? { code: d.code, name: d.name || d.code } : null
}

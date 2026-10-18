/**
 * The dictionary for the shown note (Windows/Linux): `lang:` of the note, else the first system
 * language that has a dictionary. Region-less codes take the main variant (de → de-DE).
 * An explicit but unknown `lang:` yields null and is never overridden by the system language.
 */
const MAIN: Record<string, string> = {
  de: 'de-DE',
  en: 'en-US',
  fr: 'fr-FR',
  es: 'es-ES',
  it: 'it-IT',
  pt: 'pt-BR',
  nl: 'nl',
  sv: 'sv',
  da: 'da',
  nb: 'nb',
  pl: 'pl',
  cs: 'cs',
  ru: 'ru',
  tr: 'tr',
}

const NAMES: Record<string, string> = {
  de: 'Deutsch',
  en: 'Englisch',
  fr: 'Französisch',
  es: 'Spanisch',
  it: 'Italienisch',
  pt: 'Portugiesisch',
  nl: 'Niederländisch',
  sv: 'Schwedisch',
  da: 'Dänisch',
  nb: 'Norwegisch',
  pl: 'Polnisch',
  cs: 'Tschechisch',
  ru: 'Russisch',
  tr: 'Türkisch',
}

/** Codes offered until Task 6 reads the repo's dictionaries.json. */
export const KNOWN: readonly string[] = Object.values(MAIN)

function match(tag: string, available: readonly string[]): string | null {
  const t = tag.trim().replace(/_/g, '-')
  if (!t) return null
  const exact = available.find((a) => a.toLowerCase() === t.toLowerCase())
  if (exact) return exact
  const main = MAIN[t.slice(0, 2).toLowerCase()]
  return main && available.includes(main) ? main : null
}

export function dictionaryFor(
  lang: string,
  system: readonly string[],
  available: readonly string[],
): { code: string; name: string } | null {
  const code = lang.trim()
    ? match(lang, available)
    : (system.map((s) => match(s, available)).find((c) => c !== null) ?? null)
  if (!code) return null
  return { code, name: NAMES[code.slice(0, 2).toLowerCase()] ?? code }
}

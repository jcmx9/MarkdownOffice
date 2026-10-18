import { describe, expect, it } from 'vitest'
import {
  BUILTIN_DICTIONARIES,
  type DictionaryInfo,
  dictionaryFor,
  mergeTables,
} from '../../../src/main/spellcheck/languages'

const d = (code: string, file = `${code}-3-0.bdic`, name = code): DictionaryInfo => ({
  code,
  file,
  name,
})
const avail = [
  d('de-DE', 'de-DE-3-0.bdic', 'Deutsch'),
  d('en-US', 'en-US-10-1.bdic', 'Englisch'),
  d('en-GB', 'en-GB-10-1.bdic', 'Englisch (GB)'),
  d('fr-FR', 'fr-FR-3-0.bdic', 'Französisch'),
  d('nl', 'nl-NL-3-0.bdic', 'Niederländisch'),
  d('pt-BR', 'pt-BR-3-0.bdic', 'Portugiesisch'),
]

describe('dictionaryFor', () => {
  it('lang: wins; region-less codes map to the main variant', () => {
    expect(dictionaryFor('de', ['fr-FR'], avail)?.code).toBe('de-DE')
    expect(dictionaryFor('en', [], avail)?.code).toBe('en-US')
    expect(dictionaryFor('en-GB', [], avail)?.code).toBe('en-GB')
    expect(dictionaryFor('fr', [], avail)).toEqual({ code: 'fr-FR', name: 'Französisch' })
  })
  it('without lang: the first system language with a dictionary', () => {
    expect(dictionaryFor('', ['sv-SE', 'nl-NL', 'en-US'], avail)?.code).toBe('nl')
    expect(dictionaryFor('', ['de_AT'], avail)?.code).toBe('de-DE')
  })
  it('unknown everywhere: null; an unknown lang: ignores the system language', () => {
    expect(dictionaryFor('xx', ['yy-YY'], avail)).toBeNull()
    expect(dictionaryFor('xx', ['de-DE'], avail)).toBeNull()
  })
  it('a release-only region-less code matches its regional tag', () => {
    expect(dictionaryFor('el-GR', [], [d('el', 'el-GR-3-0.bdic', 'Greek')])?.code).toBe('el')
  })
})

describe('BUILTIN_DICTIONARIES', () => {
  // Pinned against Chromium 152.0.7977.149 (Electron 44.7.2) spellcheck_common.cc:
  // region-less codes open a file with the region Chromium assigns to them.
  it.each([
    ['de-DE', 'de-DE-3-0.bdic'],
    ['en-US', 'en-US-10-1.bdic'],
    ['fr-FR', 'fr-FR-3-0.bdic'],
    ['es-ES', 'es-ES-3-0.bdic'],
    ['it-IT', 'it-IT-3-0.bdic'],
    ['pt-BR', 'pt-BR-3-0.bdic'],
    ['nl', 'nl-NL-3-0.bdic'],
    ['sv', 'sv-SE-3-0.bdic'],
    ['da', 'da-DK-3-0.bdic'],
    ['nb', 'nb-NO-3-0.bdic'],
    ['pl', 'pl-PL-3-0.bdic'],
    ['cs', 'cs-CZ-3-0.bdic'],
    ['ru', 'ru-RU-3-0.bdic'],
    ['tr', 'tr-TR-4-0.bdic'],
  ])('%s → %s', (code, file) => {
    expect(BUILTIN_DICTIONARIES.find((x) => x.code === code)?.file).toBe(file)
  })
  it('every main language part has an entry', () => {
    expect(BUILTIN_DICTIONARIES).toHaveLength(14)
  })
})

describe('mergeTables', () => {
  it('no release table: the built-in one', () => {
    expect(mergeTables(null)).toEqual(BUILTIN_DICTIONARIES)
    expect(mergeTables([])).toEqual(BUILTIN_DICTIONARIES)
  })
  it('the release decides what is offered; known codes keep the built-in file and name', () => {
    const merged = mergeTables([
      d('nl', 'nl-3-0.bdic', 'Dutch'),
      d('en-GB', 'en-GB-10-1.bdic', 'English (GB)'),
    ])
    expect(merged).toEqual([
      { code: 'nl', file: 'nl-NL-3-0.bdic', name: 'Niederländisch' },
      { code: 'en-GB', file: 'en-GB-10-1.bdic', name: 'English (GB)' },
    ])
  })
})

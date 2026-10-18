import { describe, expect, it } from 'vitest'
import { dictionaryFor } from '../../../src/main/spellcheck/languages'

const avail = ['de-DE', 'en-US', 'en-GB', 'fr-FR', 'nl', 'pt-BR']

describe('dictionaryFor', () => {
  it('lang: wins; region-less codes map to the main variant', () => {
    expect(dictionaryFor('de', ['fr-FR'], avail)?.code).toBe('de-DE')
    expect(dictionaryFor('en', [], avail)?.code).toBe('en-US')
    expect(dictionaryFor('en-GB', [], avail)?.code).toBe('en-GB')
    expect(dictionaryFor('fr', [], avail)).toEqual({ code: 'fr-FR', name: 'Französisch' })
  })
  it('without lang: the first system language with a dictionary', () => {
    expect(dictionaryFor('', ['sv-SE', 'nl-NL', 'en-US'], avail)?.code).toBe('nl')
  })
  it('unknown everywhere: null; an unknown lang: ignores the system language', () => {
    expect(dictionaryFor('xx', ['yy-YY'], avail)).toBeNull()
    expect(dictionaryFor('xx', ['de-DE'], avail)).toBeNull()
  })
})

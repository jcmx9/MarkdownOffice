import { describe, expect, it } from 'vitest'
import {
  generatedProfile,
  headerWithProfileValues,
  profileDefaults,
  withProfileDefaults,
} from '../../../src/core/profile-defaults'

const HEADER = `---
template: memo   # Set
profile: ""      # Profil
title: ""
author: ""       # Autor
lang: de         # de oder en
header: auto     # Kopfzeile
watermark: ""
---
`

describe('profileDefaults', () => {
  it('keeps non-empty values of header keys only', () => {
    const profile =
      '# Kommentar\nauthor: Anna\nstreet: Geheim 1\ntoken: abc\nwatermark: ""\ntemplate: x\nprofile: y\n'
    expect(profileDefaults(profile, HEADER)).toBe('author: Anna')
  })

  it('keeps block lists and ignores a key that merely shadows Object', () => {
    expect(profileDefaults('author:\n  - A\n  - B\n__proto__: x\n', HEADER)).toBe(
      'author:\n  - A\n  - B',
    )
  })
})

describe('withProfileDefaults', () => {
  const merge = (note: string, d = 'author: Anna\nwatermark: ENTWURF\nlang: en') =>
    withProfileDefaults(note, d)

  it('fills missing and empty keys, a value in the note wins', () => {
    expect(merge('---\nauthor: ""\nlang: de\n---\n\nText\n')).toBe(
      '---\nauthor: Anna\nlang: de\nwatermark: ENTWURF\n---\n\nText\n',
    )
    expect(merge('---\nauthor: Ben\n---\n')).toBe(
      '---\nauthor: Ben\nwatermark: ENTWURF\nlang: en\n---\n',
    )
  })

  it('keeps header: "" as the rule without text', () => {
    expect(withProfileDefaults('---\nheader: ""\n---\n', 'header: Firma')).toBe(
      '---\nheader: ""\n---\n',
    )
    expect(withProfileDefaults('---\ntitle: T\n---\n', 'header: Firma')).toBe(
      '---\ntitle: T\nheader: Firma\n---\n',
    )
  })

  it('counts a block list in the note as a value', () => {
    expect(withProfileDefaults('---\nauthor:\n  - Ben\n---\n', 'author: Anna')).toBe(
      '---\nauthor:\n  - Ben\n---\n',
    )
  })

  it('keeps CRLF and leaves notes without a closed header alone', () => {
    expect(withProfileDefaults('---\r\nauthor: ""\r\n---\r\n', 'author: A\nlang: en')).toBe(
      '---\r\nauthor: A\r\nlang: en\r\n---\r\n',
    )
    expect(merge('Text ohne Kopf\n')).toBe('Text ohne Kopf\n')
    expect(merge('---\nauthor: ""\n')).toBe('---\nauthor: ""\n')
  })
})

describe('headerWithProfileValues', () => {
  it('replaces set defaults, empty fields stay empty for the live lookup', () => {
    const out = headerWithProfileValues(HEADER, 'lang: en\nauthor: Anna\nheader: Firma')
    expect(out).toContain('lang: en\n')
    expect(out).toContain('header: Firma\n')
    expect(out).toContain('author: ""       # Autor\n')
  })
})

describe('generatedProfile', () => {
  it('lists the header fields without set, profile and per-note text', () => {
    const out = generatedProfile('memo', HEADER)
    expect(out).toContain('author: ""       # Autor\n')
    expect(out).toContain('lang: de         # de oder en\n')
    expect(out).not.toMatch(/^(template|profile|title):/m)
    expect(profileDefaults(out, HEADER)).toBe(
      'lang: de         # de oder en\nheader: auto     # Kopfzeile',
    )
  })
})

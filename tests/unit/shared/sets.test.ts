import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SET,
  headerHint,
  headerProfile,
  minimalHeader,
  SET_NAME_RE,
  withProfile,
} from '../../../src/shared/sets'

const DIN = [
  '---',
  '# Brief nach DIN 5008 Form A – alle Schlüssel: README',
  'template: din5008a      # Vorlagen-Set',
  'profile: beispiel       # Absender-Profil (profiles/<name>.yaml)',
  'x-to:                   # Anschrift',
  '  - Firma',
  '---',
  '',
].join('\n')

describe('SET_NAME_RE / DEFAULT_SET', () => {
  it.each([
    ['memo', true],
    ['din5008a', true],
    ['my_set-2', true],
    ['Memo', false],
    ['../memo', false],
    ['a/b', false],
    ['', false],
    ['mémo', false],
  ])('%j -> %s', (name, ok) => {
    expect(SET_NAME_RE.test(name)).toBe(ok)
  })

  it('defaults to memo', () => {
    expect(DEFAULT_SET).toBe('memo')
  })
})

describe('headerProfile', () => {
  it.each([
    [DIN, 'beispiel'],
    ['---\nprofile: "kanzlei"   # c\n---\n', 'kanzlei'],
    ["---\nprofile: 'a b' # c\n---\n", 'a b'],
    ['---\nprofile: ""\n---\n', ''],
    ['---\nprofile:\n---\n', ''],
    ['---\r\nprofile: x\r\n---\r\n', 'x'],
    ['---\nprofile: a#b\n---\n', 'a#b'],
    ['---\nprofile:        # Absender\n---\n', ''],
  ])('reads the value of %j', (header, value) => {
    expect(headerProfile(header)).toBe(value)
  })

  it.each([
    ['---\ntemplate: memo\n---\n'],
    ['---\nx:\n  profile: nested\n---\n'],
    ['---\n# profile: commented\n---\n'],
    ['---\ntemplate: memo\n---\nprofile: in the body\n'],
  ])('null without a column-0 key in the front matter: %j', (header) => {
    expect(headerProfile(header)).toBeNull()
  })
})

describe('withProfile', () => {
  it('replaces only the value and keeps the comment column', () => {
    const out = withProfile(DIN, 'kanzlei')
    expect(out).toContain('profile: kanzlei        # Absender-Profil (profiles/<name>.yaml)')
    expect(out.replace('kanzlei ', 'beispiel')).toBe(DIN)
  })

  it('keeps one space before the comment when the name is longer than the padding', () => {
    const out = withProfile('---\nprofile: a  # c\n---\n', 'longername')
    expect(out).toBe('---\nprofile: longername # c\n---\n')
  })

  it('fills an empty value that is followed only by a comment and keeps the comment', () => {
    const out = withProfile('---\nprofile:        # Absender\n---\n', 'ab')
    expect(out).toMatch(/^profile: ab +# Absender$/m)
  })

  it('handles quoted values, no comment, empty values and CRLF', () => {
    expect(withProfile('---\nprofile: "x"   # c\n---\n', 'ab')).toBe(
      '---\nprofile: ab    # c\n---\n',
    )
    expect(withProfile('---\nprofile: x\n---\n', 'ab')).toBe('---\nprofile: ab\n---\n')
    expect(withProfile('---\nprofile:\n---\n', 'ab')).toBe('---\nprofile: ab\n---\n')
    expect(withProfile('---\r\nprofile: x # c\r\n---\r\n', 'ab')).toBe(
      '---\r\nprofile: ab # c\r\n---\r\n',
    )
  })

  it('leaves the header unchanged without a key or with an invalid name', () => {
    const memo = '---\ntemplate: memo\n---\n'
    expect(withProfile(memo, 'kanzlei')).toBe(memo)
    expect(withProfile(DIN, 'evil: x')).toBe(DIN)
    expect(withProfile(DIN, '')).toBe(DIN)
  })
})

describe('headerHint', () => {
  it('is the first comment line without the #', () => {
    expect(headerHint(DIN)).toBe('Brief nach DIN 5008 Form A – alle Schlüssel: README')
  })

  it('is empty without a comment line', () => {
    expect(headerHint('---\ntemplate: x # inline\n---\n')).toBe('')
    expect(headerHint('---\ntemplate: x\n---\n# body heading\n')).toBe('')
  })

  it('cuts long hints to 80 characters', () => {
    const hint = headerHint(`---\n#   ${'ä'.repeat(100)}  \n---\n`)
    expect(Array.from(hint)).toHaveLength(80)
    expect(hint.endsWith('…')).toBe(true)
    expect(headerHint(`---\n# ${'a'.repeat(80)}\n---\n`)).toBe('a'.repeat(80))
  })
})

describe('minimalHeader', () => {
  it('names only the set', () => {
    expect(minimalHeader('eigen')).toBe('---\ntemplate: eigen\n---\n')
  })
})

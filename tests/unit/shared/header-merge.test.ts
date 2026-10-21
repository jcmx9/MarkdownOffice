import { describe, expect, it } from 'vitest'
import {
  applyChanges,
  dateIssue,
  isValidDate,
  mergeHeader,
  setDate,
} from '../../../src/shared/header-merge'

const MEMO = [
  '---',
  '# Alle Schlüssel: README',
  'template: memo          # Vorlagen-Set',
  'title: ""               # Titel',
  'date: ""                # leer: kein Datum',
  'lang: de                # de oder en',
  '---',
  '',
].join('\n')

const DIN = [
  '---',
  '# Brief nach DIN 5008',
  'template: din5008a      # Vorlagen-Set',
  'profile: beispiel       # Absender-Profil',
  'date: ""                # leer: heute',
  'x-to:                   # Anschrift',
  '  - Firma',
  '  - Name',
  'x-sign: true            # Unterschrift',
  '---',
  '',
].join('\n')

const memo = { template: 'memo', profile: null }

/** Applies the merge and returns the new text (throws for a refusal). */
function merged(
  note: string,
  header = MEMO,
  choice: typeof memo | { template: string; profile: string | null } = memo,
) {
  const res = mergeHeader(note, header, choice)
  if (res.kind === 'unclosed') throw new Error('unclosed')
  return applyChanges(note, res.changes)
}

describe('mergeHeader: no front matter', () => {
  it('puts the set header on top, one blank line before the text', () => {
    const res = mergeHeader('# Termin\n\nText', MEMO, memo)
    expect(res.kind).toBe('inserted')
    expect(merged('# Termin\n\nText')).toBe(`${MEMO}\n# Termin\n\nText`)
  })

  it('fills an empty note with the header alone', () => {
    expect(merged('')).toBe(MEMO)
  })

  it('adds no second blank line when the note starts with one', () => {
    expect(merged('\nText')).toBe(`${MEMO}\nText`)
  })

  it('sets the chosen profile and template in the inserted header', () => {
    const text = merged('Text', DIN, { template: 'din5008a', profile: 'kanzlei' })
    expect(text).toMatch(/^profile: kanzlei +# Absender-Profil$/m)
    expect(text).toMatch(/^template: din5008a +# Vorlagen-Set$/m)
  })

  it('adds template: to a header that lacks it', () => {
    expect(merged('Text', '---\ntitle: ""\n---\n', { template: 'eigen', profile: null })).toBe(
      '---\ntitle: ""\ntemplate: eigen\n---\n\nText',
    )
  })

  it('writes CRLF when the note uses CRLF (raw text)', () => {
    expect(merged('A\r\nB', '---\ntemplate: memo\n---\n')).toBe(
      '---\r\ntemplate: memo\r\n---\r\n\r\nA\r\nB',
    )
  })
})

describe('mergeHeader: existing front matter', () => {
  it('changes nothing when every key is there and template already matches', () => {
    const note = `${MEMO}\nText`
    const res = mergeHeader(note, MEMO, memo)
    expect(res).toEqual({ kind: 'merged', changes: [], added: [] })
  })

  it('appends missing keys with default value and comment at the bottom, in set order', () => {
    const note = '---\nlang: en\ntitle: "Mein Titel"\n---\n\nText'
    expect(merged(note)).toBe(
      [
        '---',
        'lang: en',
        'title: "Mein Titel"',
        'template: memo          # Vorlagen-Set',
        'date: ""                # leer: kein Datum',
        '---',
        '',
        'Text',
      ].join('\n'),
    )
    const res = mergeHeader(note, MEMO, memo)
    expect(res.kind === 'merged' && res.added).toEqual(['template', 'date'])
  })

  it('keeps existing values, comments, blank lines and order untouched', () => {
    const note = '---\n# meine Notiz\nlang: en   # Englisch\n\ntitle: x\n---\nText'
    expect(merged(note)).toBe(
      [
        '---',
        '# meine Notiz',
        'lang: en   # Englisch',
        '',
        'title: x',
        'template: memo          # Vorlagen-Set',
        'date: ""                # leer: kein Datum',
        '---',
        'Text',
      ].join('\n'),
    )
  })

  it('never duplicates a key, also not a nested-looking or repeated one', () => {
    const note = '---\ntitle: a\ndate: 2026-10-20\nlang: de\ntemplate: memo\n---\n'
    const header = `${MEMO.slice(0, -4)}title: ""   # doppelt\n---\n`
    const text = merged(note, header)
    expect(text).toBe(note)
  })

  it('treats an indented key as nested (not present), like the pipeline', () => {
    const note = '---\nx:\n  lang: en\ntitle: a\ndate: ""\ntemplate: memo\n---\n'
    expect(merged(note)).toBe(
      '---\nx:\n  lang: en\ntitle: a\ndate: ""\ntemplate: memo\nlang: de                # de oder en\n---\n',
    )
  })

  it('copies a multi-line value (list) as a whole', () => {
    const note = '---\ntemplate: din5008a\nprofile: anna\ndate: ""\nx-sign: false\n---\nText'
    expect(merged(note, DIN, { template: 'din5008a', profile: null })).toBe(
      [
        '---',
        'template: din5008a',
        'profile: anna',
        'date: ""',
        'x-sign: false',
        'x-to:                   # Anschrift',
        '  - Firma',
        '  - Name',
        '---',
        'Text',
      ].join('\n'),
    )
  })

  it('replaces template: in place, keeping its comment column', () => {
    const note = '---\ntemplate: memo          # mein Set\ntitle: x\n---\n'
    const text = merged(note, '---\ntemplate: din5008a\ntitle: ""\n---\n', {
      template: 'din5008a',
      profile: null,
    })
    expect(text).toBe('---\ntemplate: din5008a      # mein Set\ntitle: x\n---\n')
  })

  it('replaces a quoted template value and every duplicate template: line', () => {
    const note = '---\ntemplate: "memo"\ntemplate: alt\n---\n'
    expect(merged(note, '---\ntemplate: x\n---\n', { template: 'brief', profile: null })).toBe(
      '---\ntemplate: brief\ntemplate: brief\n---\n',
    )
  })

  it('appends template: when neither note nor set header has it', () => {
    expect(
      merged('---\ntitle: a\n---\n', '---\ntitle: ""\n---\n', { template: 'eigen', profile: null }),
    ).toBe('---\ntitle: a\ntemplate: eigen\n---\n')
  })

  it('sets the chosen profile in place, else appends the set’s line with it', () => {
    const din = { template: 'din5008a', profile: 'kanzlei' }
    const inPlace = merged('---\nprofile: anna   # wer\n---\n', DIN, din)
    expect(inPlace).toMatch(/^profile: kanzlei # wer$/m)
    expect(inPlace.match(/^profile:/gm)).toHaveLength(1)
    const appended = merged('---\ntitle: a\n---\n', DIN, din)
    expect(appended).toMatch(/^profile: kanzlei +# Absender-Profil$/m)
  })

  it('without a chosen profile an existing profile: stays as it is', () => {
    const note = '---\nprofile: anna\n---\n'
    expect(merged(note, DIN, { template: 'din5008a', profile: null })).toMatch(/^profile: anna$/m)
  })

  it('keeps CRLF of a raw CRLF note, also for appended lines', () => {
    const note = '---\r\ntitle: a\r\n---\r\n\r\nText\r\n'
    expect(merged(note, '---\ntemplate: memo   # Set\ntitle: ""\n---\n')).toBe(
      '---\r\ntitle: a\r\ntemplate: memo   # Set\r\n---\r\n\r\nText\r\n',
    )
  })

  it('keeps a mixed note’s per-line \\r on in-place replacements', () => {
    const note = '---\ntemplate: memo\r\ntitle: a\n---\n'
    expect(
      merged(note, '---\ntemplate: x\ntitle: ""\n---\n', { template: 'brief', profile: null }),
    ).toBe('---\ntemplate: brief\r\ntitle: a\n---\n')
  })

  it('accepts `...` as the closing fence', () => {
    expect(merged('---\ntitle: a\n...\nText', '---\ntemplate: memo\n---\n')).toBe(
      '---\ntitle: a\ntemplate: memo\n...\nText',
    )
  })

  it('refuses an unclosed front matter (merging would swallow the note)', () => {
    expect(mergeHeader('---\ntitle: a\nText', MEMO, memo)).toEqual({ kind: 'unclosed' })
  })

  it('ignores invalid set or profile names (no YAML syntax into the note)', () => {
    const note = '---\ntemplate: memo\n---\n'
    expect(merged(note, '---\ntemplate: x\n---\n', { template: 'a: b', profile: null })).toBe(note)
  })
})

describe('isValidDate', () => {
  it.each([
    ['', true],
    ['2026-10-20', true],
    ['20.10.2026', true],
    ['1.2.2026', true],
    ['01.02.2026', true],
    ['2026-1-5', false],
    ['20.10.26', false],
    ['2026/10/20', false],
    ['20. Oktober 2026', false],
    ['heute', false],
    ['2026-02-30', false],
    ['31.04.2026', false],
    ['2026-13-01', false],
    ['2024-02-29', true],
  ])('%j -> %s', (value, ok) => {
    expect(isValidDate(value)).toBe(ok)
  })
})

describe('dateIssue / setDate', () => {
  it('is null for a valid, empty or missing date and without front matter', () => {
    expect(dateIssue('---\ndate: 2026-10-20   # x\n---\n')).toBeNull()
    expect(dateIssue('---\ndate: ""\n---\n')).toBeNull()
    expect(dateIssue("---\ndate: '20.10.2026'\n---\n")).toBeNull()
    expect(dateIssue('---\ndate:\n---\n')).toBeNull()
    expect(dateIssue('---\ntitle: a\n---\n')).toBeNull()
    expect(dateIssue('date: 20/10/2026\n')).toBeNull()
  })

  it('names a wrong notation (quotes and comment stripped; the last date: counts)', () => {
    expect(dateIssue('---\ndate: "20/10/2026"   # Datum\n---\n')).toEqual({ value: '20/10/2026' })
    expect(dateIssue('---\ndate: 2026-10-20\ndate: Oktober\n---\n')).toEqual({ value: 'Oktober' })
  })

  it('setDate replaces the value in place, keeping comment and line ending', () => {
    const note = '---\r\ndate: "20/10/2026"   # Datum\r\n---\r\n'
    expect(applyChanges(note, setDate(note, '2026-10-20'))).toBe(
      '---\r\ndate: 2026-10-20     # Datum\r\n---\r\n',
    )
  })

  it('setDate changes nothing without front matter or date:', () => {
    expect(setDate('Text', '2026-10-20')).toEqual([])
    expect(setDate('---\ntitle: a\n---\n', '2026-10-20')).toEqual([])
  })
})

describe('applyChanges', () => {
  it('applies non-overlapping changes in any order', () => {
    expect(
      applyChanges('abcdef', [
        { from: 4, to: 6, insert: 'X' },
        { from: 0, to: 1, insert: 'Y' },
      ]),
    ).toBe('YbcdX')
  })
})

import { describe, expect, it } from 'vitest'
import { combineSchemas, PIPELINE_SCHEMA, parseSchema } from '../../../src/core/frontmatter-schema'
import {
  errorCount,
  type Finding,
  type FindingCode,
  noteSet,
  quoteYaml,
  rewriteValue,
  selectedChanges,
  topLevelValue,
  type ValidationContext,
  validateFrontmatter,
} from '../../../src/core/frontmatter-validate'
import { applyChanges, mergeHeader } from '../../../src/core/header-merge'
import { findingMessage } from '../../../src/core/validate-messages'

const SET = parseSchema(
  [
    'schema: 1',
    'keys:',
    '  x-sign: { type: bool }',
    '  x-attachments: { type: list }',
    '  x-to: { type: lines, max: 6 }',
    '  zip: { type: text }',
    '  lang: { type: enum, values: [de, en] }',
    '',
  ].join('\n'),
)
if (!SET.ok) throw new Error(SET.error)

const pipelineCtx: ValidationContext = {
  schema: PIPELINE_SCHEMA,
  sets: null,
  header: null,
  profile: null,
}
const setCtx: ValidationContext = {
  ...pipelineCtx,
  schema: combineSchemas(PIPELINE_SCHEMA, SET.schema),
}
// lang is restricted by the set only in its own context
const langSetCtx: ValidationContext = {
  ...pipelineCtx,
  schema: combineSchemas(PIPELINE_SCHEMA, {
    keys: { lang: { type: 'enum', values: ['de', 'en'] } },
  }),
}

const note = (...lines: string[]): string => `---\n${lines.join('\n')}\n---\n\nBody\n`

function check(text: string, ctx: ValidationContext = pipelineCtx): Finding[] {
  const r = validateFrontmatter(text, ctx)
  if (r.kind !== 'checked') throw new Error(`not checked: ${r.kind}`)
  return r.findings
}

function one(line: string, ctx: ValidationContext = pipelineCtx): Finding {
  const found = check(note(line), ctx)
  expect(found, line).toHaveLength(1)
  return found[0] as Finding
}

describe('result kinds', () => {
  it('reports none and unclosed', () => {
    expect(validateFrontmatter('Just text\n', pipelineCtx)).toEqual({ kind: 'none' })
    expect(validateFrontmatter('---\ntoc: ja\n', pipelineCtx)).toEqual({ kind: 'unclosed' })
  })

  it('returns an empty checked result for a clean header', () => {
    expect(validateFrontmatter(note('toc: auto'), pipelineCtx)).toEqual({
      kind: 'checked',
      findings: [],
      missing: [],
      missingChanges: [],
    })
  })
})

describe('bool', () => {
  it.each([
    ['isodate_praefix: ja', pipelineCtx, 'true'],
    ['x-sign: nein', setCtx, 'false'],
    ['embed_source: 1', pipelineCtx, 'true'],
  ])('%s is an error', (line, ctx, suggestion) => {
    const f = one(line, ctx)
    expect(f.code).toBe('validate.bool')
    expect(f.severity).toBe('error')
    expect(f.suggestion).toBe(suggestion)
    expect(f.preselected).toBe(true)
    const key = line.split(':')[0]
    expect(applyChanges(note(line), f.changes)).toBe(note(`${key}: ${suggestion}`))
  })

  it.each([
    ['print_filename: Yes', 'true'],
    ['hard_breaks: OFF', 'false'],
  ])('%s is a warning', (line, suggestion) => {
    const f = one(line)
    expect(f.code).toBe('validate.bool')
    expect(f.severity).toBe('warning')
    expect(f.suggestion).toBe(suggestion)
    const key = line.split(':')[0]
    expect(applyChanges(note(line), f.changes)).toBe(note(`${key}: ${suggestion}`))
  })

  it('has no fix for an unknown word', () => {
    const f = one('hard_breaks: maybe')
    expect(f.severity).toBe('error')
    expect(f.suggestion).toBeNull()
    expect(f.changes).toEqual([])
    expect(f.preselected).toBe(false)
  })

  it('accepts true and false', () => {
    expect(check(note('hard_breaks: true', 'embed_source: false'))).toEqual([])
  })

  // build.sh reads y/n as a bool; a set reads its keys with Typst's yaml(), where y and n stay
  // text (din5008a's flag() takes `x-sign: y` as false).
  it.each([
    ['x-sign: y', 'true'],
    ['x-sign: N', 'false'],
  ])('set key %s is an error', (line, suggestion) => {
    const f = one(line, setCtx)
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.bool', 'error', suggestion])
  })

  it('pipeline key y stays a warning', () => {
    const f = one('hard_breaks: y')
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.bool', 'warning', 'true'])
  })
})

describe('enum', () => {
  it('maps ja to true as an error', () => {
    const f = one('toc: ja')
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.enum', 'error', 'true'])
  })

  it.each(['toc: Auto', 'h1_break: AUTO'])('%s is a warning (build.sh lower-cases it)', (line) => {
    const f = one(line)
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.enum', 'warning', 'auto'])
    const key = line.split(':')[0]
    expect(applyChanges(note(line), f.changes)).toBe(note(`${key}: auto`))
  })

  it('keeps a case slip in another enum an error', () => {
    const f = one('lang: DE', langSetCtx)
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.enum', 'error', 'de'])
    expect(applyChanges(note('lang: DE'), f.changes)).toBe(note('lang: de'))
  })

  it('takes yes as a warning', () => {
    const f = one('toc: yes')
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.enum', 'warning', 'true'])
    expect(applyChanges(note('toc: yes'), f.changes)).toBe(note('toc: true'))
  })

  it('has no fix for an unknown value', () => {
    const f = one('toc: sometimes')
    expect([f.severity, f.suggestion, f.changes]).toEqual(['error', null, []])
    expect(f.params.allowed).toBe('auto, true, false')
  })

  it('checks a set enum (lang)', () => {
    const f = one('lang: fr', langSetCtx)
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.enum', 'error', null])
  })
})

describe('date', () => {
  it.each([
    ['date: 20.10.26', '2026-10-20'],
    ['date: 20. Oktober 2026', '2026-10-20'],
    ['date: 5. Mrz 2026', '2026-03-05'],
    ['date: 5. März 2026', '2026-03-05'],
    ['date: 5. Mär 2026', '2026-03-05'],
    ['date: 13/10/2026', '2026-10-13'],
  ])('%s is an error with a suggestion', (line, iso) => {
    const f = one(line)
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.date.invalid', 'error', iso])
    expect(applyChanges(note(line), f.changes)).toBe(note(`date: ${iso}`))
  })

  it('takes a one-digit ISO date as a warning', () => {
    const f = one('date: 2026-1-5')
    expect([f.code, f.severity, f.suggestion]).toEqual([
      'validate.date.invalid',
      'warning',
      '2026-01-05',
    ])
    expect(applyChanges(note('date: 2026-1-5'), f.changes)).toBe(note('date: 2026-01-05'))
  })

  it('does not guess an ambiguous D/M/YYYY', () => {
    const f = one('date: 05/04/2026')
    expect([f.code, f.severity, f.suggestion, f.changes]).toEqual([
      'validate.date.invalid',
      'error',
      null,
      [],
    ])
  })

  it.each(['date: 31.04.2026', 'date: 2026-02-30'])('%s is impossible', (line) => {
    const f = one(line)
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.date.impossible', 'error', null])
  })

  it('reports an impossible day behind a convertible notation', () => {
    expect(one('date: 31.04.26').code).toBe('validate.date.impossible')
  })

  it.each(['date: 13.10.2026', 'date: ""', 'date:', "date: ''", 'date: 2026-10-13'])(
    '%s is fine',
    (line) => {
      expect(check(note(line))).toEqual([])
    },
  )

  it('has no suggestion for free text', () => {
    const f = one('date: tomorrow')
    expect([f.code, f.suggestion]).toEqual(['validate.date.invalid', null])
  })
})

describe('length', () => {
  // memo's own check accepts `15 mm` and the export works: not canonical, so a warning.
  it('takes a space before the unit as a warning', () => {
    const f = one('logo-height: 15 mm')
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.length', 'warning', '15mm'])
    expect(applyChanges(note('logo-height: 15 mm'), f.changes)).toBe(note('logo-height: 15mm'))
  })

  it.each([
    ['logo-height: 15', '15mm'],
    ['logo-height: 15MM', '15mm'],
    ['logo-height: 1,5cm', '1.5cm'],
  ])('%s is written canonically', (line, suggestion) => {
    const f = one(line)
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.length', 'error', suggestion])
    expect(applyChanges(note(line), f.changes)).toBe(note(`logo-height: ${suggestion}`))
  })

  it('warns when over the maximum', () => {
    const f = one('logo-height: 30mm')
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.length.max', 'warning', '25mm'])
    expect(applyChanges(note('logo-height: 30mm'), f.changes)).toBe(note('logo-height: 25mm'))
  })

  it('compares in millimetres across units', () => {
    expect(check(note('logo-height: 2.5cm'))).toEqual([])
    expect(one('logo-height: 2in').code).toBe('validate.length.max')
  })

  it('has no fix for words', () => {
    const f = one('logo-height: big')
    expect([f.code, f.severity, f.suggestion, f.changes]).toEqual([
      'validate.length',
      'error',
      null,
      [],
    ])
  })

  it('accepts a value in range', () => {
    expect(check(note('logo-height: 15mm'))).toEqual([])
  })

  it('warns when under the minimum', () => {
    const ctx = {
      ...pipelineCtx,
      schema: combineSchemas(PIPELINE_SCHEMA, {
        keys: { 'x-gap': { type: 'length', min: '5mm', max: '2cm' } },
      }),
    }
    const f = one('x-gap: 0.2cm', ctx)
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.length.min', 'warning', '5mm'])
    expect(f.params).toEqual({ value: '0.2cm', min: '5mm' })
    expect(applyChanges(note('x-gap: 0.2cm'), f.changes)).toBe(note('x-gap: 5mm'))
    expect(check(note('x-gap: 5mm'), ctx)).toEqual([])
    expect(one('x-gap: 3cm', ctx).code).toBe('validate.length.max')
  })
})

describe('list and lines', () => {
  it('wraps a scalar into an inline list', () => {
    const f = one('x-attachments: Angebot', setCtx)
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.list', 'error', '[Angebot]'])
    expect(applyChanges(note('x-attachments: Angebot'), f.changes)).toBe(
      note('x-attachments: [Angebot]'),
    )
  })

  it('accepts inline and block lists', () => {
    expect(check(note('x-attachments: [A, B]'), setCtx)).toEqual([])
    expect(check(note('x-attachments:', '  - A', '  - B'), setCtx)).toEqual([])
  })

  it('flags more block items than max', () => {
    const items = Array.from({ length: 7 }, (_, i) => `  - Line ${i + 1}`)
    const f = one(
      note('x-to:', ...items)
        .split('---\n')[1]
        ?.trimEnd() ?? '',
      setCtx,
    )
    expect([f.code, f.severity, f.suggestion, f.changes]).toEqual([
      'validate.lines.max',
      'error',
      null,
      [],
    ])
    expect(f.params).toMatchObject({ count: '7', max: '6' })
  })

  it('accepts exactly max items', () => {
    const items = Array.from({ length: 6 }, (_, i) => `  - Line ${i + 1}`)
    expect(check(note('x-to:', ...items), setCtx)).toEqual([])
  })

  it('counts the items of an inline list', () => {
    expect(check(note('x-to: [1, 2, 3, 4, 5, 6, 7]'), setCtx)[0]?.code).toBe('validate.lines.max')
  })

  it('does not count nested items of an item', () => {
    const lines = ['x-to:', ...['a', 'b'].flatMap((s) => [`  - ${s}`, '    - nested'])]
    expect(check(note(...lines), setCtx)).toEqual([])
  })
})

describe('text', () => {
  // A set key is read by Typst's yaml() (YAML 1.2): a value it types otherwise is an error.
  it.each([
    ['zip: 01067', '"01067"'],
    ['zip: true', '"true"'],
    ['zip: ~', '"~"'],
  ])('set key %s is read as another type', (line, suggestion) => {
    const f = one(line, setCtx)
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.text.quote', 'error', suggestion])
    const key = line.split(':')[0]
    expect(applyChanges(note(line), f.changes)).toBe(note(`${key}: ${suggestion}`))
  })

  // build.sh passes a pipeline key on as raw text: never misread, so a warning at most.
  it.each([
    ['subtitle: ~', '"~"'],
    ['title: true', '"true"'],
  ])('pipeline key %s is only a warning', (line, suggestion) => {
    const f = one(line)
    expect([f.code, f.severity, f.suggestion]).toEqual([
      'validate.text.quote',
      'warning',
      suggestion,
    ])
  })

  // YAML 1.1 words and sexagesimals are plain strings in YAML 1.2, as both readers see them.
  it.each([
    'title: no',
    'subtitle: 12:30',
    'toptitle: on',
    'title: Y',
    'title: 2026',
    'author: [Anna, Ben]',
    'title: "true"',
    "title: 'true'",
    'title: Hello',
  ])('%s is fine', (line) => {
    expect(check(note(line))).toEqual([])
  })

  it.each(['zip: no', 'zip: 12:30', 'zip: yes'])('set key %s is fine', (line) => {
    expect(check(note(line), setCtx)).toEqual([])
  })

  it('keeps the comment of a rewritten value', () => {
    const text = note('zip: 01067   # postcode')
    const f = one('zip: 01067   # postcode', setCtx)
    expect(applyChanges(text, f.changes)).toBe(note('zip: "01067" # postcode'))
  })
})

describe('file, name, lang', () => {
  it('warns about a wrong logo extension', () => {
    const f = one('logo: firma.gif')
    expect([f.code, f.severity, f.suggestion, f.changes]).toEqual([
      'validate.file.ext',
      'warning',
      null,
      [],
    ])
  })

  it('accepts a logo with an allowed extension in any case', () => {
    expect(check(note('logo: Firma.SVG'))).toEqual([])
  })

  it('suggests the lower-case language', () => {
    const f = one('lang: DE')
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.lang', 'error', 'de'])
    expect(applyChanges(note('lang: DE'), f.changes)).toBe(note('lang: de'))
  })

  it('has no fix for de_DE', () => {
    const f = one('lang: de_DE')
    expect([f.code, f.suggestion]).toEqual(['validate.lang', null])
  })

  it('accepts de and de-AT', () => {
    expect(check(note('lang: de'))).toEqual([])
    expect(check(note('lang: de-AT'))).toEqual([])
  })

  it('checks a name key', () => {
    const ctx: ValidationContext = {
      ...pipelineCtx,
      schema: { keys: { 'x-set': { type: 'name' } } },
    }
    expect(one('x-set: Memo', ctx).code).toBe('validate.name')
    expect(check(note('x-set: memo-2'), ctx)).toEqual([])
  })
})

describe('structure of the findings', () => {
  it('numbers lines from the opening fence and builds stable ids', () => {
    const text = note('title: Hi', 'toc: ja')
    const f = check(text)[0] as Finding
    expect(f.line).toBe(3)
    expect(f.key).toBe('toc')
    expect(f.id).toBe('validate.enum:3:toc')
    expect(check(text)[0]?.id).toBe(f.id)
  })

  it('checks only the last of duplicate keys', () => {
    const values = (text: string) => check(text).filter((f) => f.code !== 'validate.duplicate')
    expect(values(note('toc: ja', 'toc: auto'))).toEqual([])
    expect(values(note('toc: auto', 'toc: ja'))[0]?.line).toBe(3)
  })

  it('ignores keys not in the schema and nested keys', () => {
    expect(check(note('x-other: whatever', 'map:', '  toc: ja', '  title: no'))).toEqual([])
  })

  it('ignores an empty value and a block scalar', () => {
    expect(check(note('toc:', 'hard_breaks: ""', 'title: |', '  no'))).toEqual([])
  })

  it('preselects only findings with a fix', () => {
    const [a, b] = check(note('toc: ja', 'toc2: x', 'hard_breaks: maybe'))
    expect(a?.preselected).toBe(true)
    expect(b?.preselected).toBe(false)
  })

  it('keeps CRLF per line and the BOM', () => {
    const text = '﻿---\r\ntitle: Hi\r\ntoc: ja  # c\r\nlang: DE\n---\r\n\r\nBody\r\n'
    const found = check(text)
    expect(found.map((f) => f.line)).toEqual([3, 4])
    expect(
      applyChanges(
        text,
        found.flatMap((f) => f.changes),
      ),
    ).toBe('﻿---\r\ntitle: Hi\r\ntoc: true # c\r\nlang: de\n---\r\n\r\nBody\r\n')
  })

  it('does not touch the bytes around a fix', () => {
    const text = note('title: A', 'toc: ja', 'title2: B')
    const f = check(text)[0] as Finding
    expect(applyChanges(text, f.changes)).toBe(note('title: A', 'toc: true', 'title2: B'))
  })
})

describe('helpers', () => {
  it('rewriteValue keeps the comment column and the CR', () => {
    expect(rewriteValue('toc: Auto   # auto, true, false\r', 'toc', 'auto')).toBe(
      'toc: auto   # auto, true, false\r',
    )
  })

  it('rewriteValue never cuts quoted text and keeps the comment column', () => {
    const line = 'title: "A # B"   # c'
    const out = rewriteValue(line, 'title', '"no"')
    expect(out).toBe('title: "no"      # c')
    expect(out.indexOf('# c')).toBe(line.indexOf('# c'))
  })

  it('rewriteValue leaves other lines alone', () => {
    expect(rewriteValue('subtitle: x', 'title', 'y')).toBe('subtitle: x')
  })

  it('quoteYaml double-quotes and escapes', () => {
    expect(quoteYaml('no')).toBe('"no"')
    expect(quoteYaml('a"b\\c')).toBe('"a\\"b\\\\c"')
  })

  it('topLevelValue returns the last unquoted value without comment', () => {
    const text = note('template: "a"', 'template: memo   # set', 'map:', '  template: no')
    expect(topLevelValue(text, 'template')).toBe('memo')
    expect(topLevelValue(text, 'missing')).toBeNull()
    expect(topLevelValue('no front matter', 'template')).toBeNull()
    expect(topLevelValue(note('template:'), 'template')).toBe('')
  })

  it('noteSet falls back to the default set', () => {
    expect(noteSet(note('template: din5008a'))).toBe('din5008a')
    expect(noteSet(note('template:'))).toBe('memo')
    expect(noteSet(note('title: x'))).toBe('memo')
    expect(noteSet('plain')).toBe('memo')
    expect(noteSet(note('template: ./my.typ'))).toBe('')
    expect(noteSet(note('template: ./My.TYP'))).toBe('')
  })
})

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

const result = (text: string, ctx: ValidationContext = pipelineCtx) => {
  const r = validateFrontmatter(text, ctx)
  if (r.kind !== 'checked') throw new Error(`not checked: ${r.kind}`)
  return r
}

describe('syntax', () => {
  it('quotes a value with a colon', () => {
    const f = one('title: Kickoff: X')
    expect([f.code, f.severity, f.line, f.suggestion]).toEqual([
      'validate.syntax',
      'error',
      2,
      '"Kickoff: X"',
    ])
    expect(applyChanges(note('title: Kickoff: X'), f.changes)).toBe(note('title: "Kickoff: X"'))
  })

  it('reports a tab-indented line without a fix and keeps checking the rest', () => {
    const found = check(note('title: A', '\tbad: 1', 'toc: ja'))
    const syntax = found.find((f) => f.code === 'validate.syntax')
    expect(syntax?.severity).toBe('error')
    expect(syntax?.params.reason).toBeTruthy()
    expect(syntax?.changes).toEqual([])
    expect(found.some((f) => f.code === 'validate.enum')).toBe(true)
  })

  it('reports an unclosed inline list', () => {
    const found = check(note('title: A', 'x-attachments: [a, b'), setCtx)
    const syntax = found.find((f) => f.code === 'validate.syntax')
    expect(syntax?.severity).toBe('error')
    expect(syntax?.line).toBeGreaterThanOrEqual(2)
  })
})

describe('duplicates', () => {
  it('flags the earlier line, deletes it with its block and checks the later value', () => {
    const text = note('date: 2026-01-05', 'x-to:', '  - A', 'x-to:', '  - B', 'date: 20.10.26')
    const found = check(text, setCtx)
    const dups = found.filter((f) => f.code === 'validate.duplicate')
    expect(dups.map((f) => [f.line, f.key, f.severity, f.params.first])).toEqual([
      [2, 'date', 'error', '2'],
      [3, 'x-to', 'error', '3'],
    ])
    expect(
      applyChanges(
        text,
        dups.flatMap((f) => f.changes),
      ),
    ).toBe(note('x-to:', '  - B', 'date: 20.10.26'))
    expect(found.find((f) => f.code === 'validate.date.invalid')?.line).toBe(7)
  })
})

describe('template and profile', () => {
  const sets = { ...pipelineCtx, sets: ['memo', 'din5008a'] }

  it('suggests the nearest installed set', () => {
    const text = note('template: memmo   # set')
    const f = one('template: memmo   # set', sets)
    expect([f.code, f.severity, f.suggestion]).toEqual([
      'validate.template.unknown',
      'error',
      'memo',
    ])
    expect(applyChanges(text, f.changes)).toBe(note('template: memo    # set'))
  })

  it('reports an unknown set without a near miss and accepts the rest', () => {
    const f = one('template: zzzzzz', sets)
    expect([f.code, f.suggestion, f.changes]).toEqual(['validate.template.unknown', null, []])
    expect(check(note('template: brief.typ'), sets)).toEqual([])
    expect(check(note('template: Brief.TYP'), sets)).toEqual([])
    expect(check(note('template: memmo'), pipelineCtx)).toEqual([])
    expect(check(note('template: memo'), sets)).toEqual([])
  })

  it('reports a profile that was not found', () => {
    const ctx: ValidationContext = {
      ...pipelineCtx,
      profile: { status: 'missing', searched: ['/a/profiles', '/b/profiles'] },
    }
    const f = one('profile: x', ctx)
    expect([f.code, f.severity, f.changes]).toEqual(['validate.profile.missing', 'error', []])
    expect(f.params.searched).toBe('/a/profiles\n/b/profiles')
    expect(findingMessage(f)).toContain('/b/profiles')
  })

  it('reports an invalid profile and ignores a lookup without a profile key', () => {
    const ctx = { ...pipelineCtx, profile: { status: 'invalid' } as const }
    expect(one('profile: x y', ctx).code).toBe('validate.profile.invalid')
    expect(check(note('title: A'), ctx)).toEqual([])
  })
})

describe('key typos', () => {
  it('suggests the schema key as a hint that renames only the key', () => {
    const text = note('titel: X   # c', 'subtile: Y')
    const found = check(text)
    expect(found.map((f) => [f.code, f.severity, f.suggestion, f.preselected])).toEqual([
      ['validate.key.typo', 'hint', 'title', false],
      ['validate.key.typo', 'hint', 'subtitle', false],
    ])
    expect(
      applyChanges(
        text,
        found.flatMap((f) => f.changes),
      ),
    ).toBe(note('title: X   # c', 'subtitle: Y'))
  })

  it('allows x- keys and distant keys', () => {
    expect(check(note('x-titel: A', 'foo: B', 'something: C'))).toEqual([])
  })

  // Renaming `titel` would duplicate the `title` that is already there.
  it('skips a key whose similar key is already present', () => {
    expect(check(note('titel: X', 'title: Y'))).toEqual([])
    expect(check(note('title: Y', 'titel: X'))).toEqual([])
  })

  it('skips a schema key with a number appended', () => {
    expect(check(note('title2: A', 'toc2: B', 'subtitle10: C'))).toEqual([])
  })
})

// Keys named like Object.prototype members must be plain keys, never the prototype's.
describe('prototype key names', () => {
  it.each(['constructor: x', 'toString: y', '__proto__: z', 'hasOwnProperty: w', 'valueOf: 1'])(
    '%s is no finding and no crash',
    (line) => {
      expect(check(note('title: T', line))).toEqual([])
    },
  )

  it('never takes a prototype member as a known value', () => {
    expect(one('isodate_praefix: constructor').suggestion).toBeNull()
    expect(one('date: 1. constructor 2026').code).toBe('validate.date.invalid')
  })

  it('checks a __proto__ key declared in a set schema', () => {
    const set = parseSchema('schema: 1\nkeys:\n  __proto__: { type: bool }\n')
    if (!set.ok) throw new Error(set.error)
    expect(Object.hasOwn(set.schema.keys, '__proto__')).toBe(true)
    const schema = combineSchemas(PIPELINE_SCHEMA, set.schema)
    expect(Object.hasOwn(schema.keys, '__proto__')).toBe(true)
    expect(Object.hasOwn(schema.keys, 'title')).toBe(true)
    const f = one('__proto__: ja', { ...pipelineCtx, schema })
    expect([f.code, f.suggestion]).toEqual(['validate.bool', 'true'])
  })
})

describe('nested keys', () => {
  it('are never duplicates, typos or type findings', () => {
    const text = note(
      'x-to:',
      '  - title: A',
      '  - B',
      'title: Top',
      'map:',
      '  title: no',
      '  toc: ja',
    )
    expect(check(text, setCtx)).toEqual([])
  })
})

describe('missing keys', () => {
  const ctx = { ...pipelineCtx, header: MEMO }

  it('lists the header keys the note lacks, in header order', () => {
    const text = note('title: Hi')
    const r = result(text, ctx)
    expect(r.missing).toEqual(['template', 'date', 'lang'])
    const merged = mergeHeader(text, MEMO, { template: 'memo', profile: null })
    if (merged.kind !== 'merged') throw new Error('not merged')
    expect(applyChanges(text, r.missingChanges)).toBe(applyChanges(text, merged.changes))
    expect(applyChanges(text, r.missingChanges)).toBe(
      note(
        'title: Hi',
        'template: memo          # Vorlagen-Set',
        'date: ""                # leer: kein Datum',
        'lang: de                # de oder en',
      ),
    )
  })

  it('never rewrites an existing template', () => {
    const text = note('template:   "memo"', 'title: Hi')
    const r = result(text, ctx)
    expect(applyChanges(text, r.missingChanges)).not.toContain('template: memo')
    expect(r.missing).toEqual(['date', 'lang'])
  })

  it('is empty without a header or when nothing is missing', () => {
    expect(result(note('title: Hi')).missing).toEqual([])
    const full = note('template: memo', 'title: A', 'date: ""', 'lang: de')
    expect(result(full, ctx)).toMatchObject({ missing: [], missingChanges: [] })
  })

  it('handles a BOM and CRLF', () => {
    const text = '\uFEFF---\r\ntitle: Hi\r\n---\r\n\r\nBody\r\n'
    const r = result(text, ctx)
    expect(applyChanges(text, r.missingChanges)).toBe(
      '\uFEFF---\r\ntitle: Hi\r\ntemplate: memo          # Vorlagen-Set\r\ndate: ""                # leer: kein Datum\r\nlang: de                # de oder en\r\n---\r\n\r\nBody\r\n',
    )
  })
})

describe('CRLF and mixed line ends', () => {
  const lines = ['title: Hi', 'toc: ja', 'toc: auto', 'titel: X', 'date: 20.10.26']
  const lf = note(...lines)
  const crlf = lf.replace(/\n/g, '\r\n')

  it('gives the same findings for CRLF', () => {
    const strip = (fs: Finding[]) => fs.map((f) => [f.id, f.severity])
    expect(strip(check(crlf))).toEqual(strip(check(lf)))
  })

  it("keeps every untouched byte and each rewritten line's CR", () => {
    const mixed = '---\r\ntitle: Hi\r\ndate: 20.10.26  # d\r\nlang: DE\n---\n\nBody\n'
    const r = result(mixed)
    const ids = new Set(r.findings.filter((f) => f.preselected).map((f) => f.id))
    expect(applyChanges(mixed, selectedChanges(r, ids, false))).toBe(
      '---\r\ntitle: Hi\r\ndate: 2026-10-20 # d\r\nlang: de\n---\n\nBody\n',
    )
  })
})

describe('overlapping fixes', () => {
  it('keeps one fix per line', () => {
    const f = check(note('title: Kickoff: no'))
    expect(f.filter((x) => x.changes.length > 0).length).toBeLessThanOrEqual(1)
  })
})

describe('selectedChanges and errorCount', () => {
  const text = note('title: A', 'toc: ja', 'toc: true', 'date: 20.10.26', 'lang: DE', 'subtile: B')
  const ctx = { ...pipelineCtx, header: MEMO }
  const r = result(text, ctx)

  it('applies all preselected fixes plus the missing keys in one go, in any order', () => {
    const ids = new Set(r.findings.filter((f) => f.preselected).map((f) => f.id))
    const all = selectedChanges(r, ids, true)
    const combined = applyChanges(text, all)
    const sequential = [...all]
      .sort((a, b) => a.from - b.from)
      .reduceRight((acc, c) => applyChanges(acc, [c]), text)
    expect(combined).toBe(sequential)
    expect(combined).toContain('date: 2026-10-20')
    expect(combined).toContain('lang: de')
    expect(combined).toContain('template: memo')
    expect(combined).toContain('subtile: B') // a hint is not preselected
  })

  it('selects by id and skips the missing keys unless asked', () => {
    const first = r.findings[0] as Finding
    expect(selectedChanges(r, new Set([first.id]), false)).toEqual(first.changes)
    expect(selectedChanges(r, new Set(), false)).toEqual([])
    expect(selectedChanges(r, new Set(), true)).toEqual(r.missingChanges)
    expect(selectedChanges({ kind: 'none' }, new Set(['x']), true)).toEqual([])
  })

  it('counts only errors', () => {
    const errors = r.findings.filter((f) => f.severity === 'error').length
    expect(errors).toBeGreaterThan(0)
    expect(errors).toBeLessThan(r.findings.length)
    expect(errorCount(r)).toBe(errors)
    expect(errorCount({ kind: 'unclosed' })).toBe(0)
  })
})

describe('findingMessage', () => {
  const codes: FindingCode[] = [
    'validate.syntax',
    'validate.duplicate',
    'validate.bool',
    'validate.enum',
    'validate.date.invalid',
    'validate.date.impossible',
    'validate.length',
    'validate.length.max',
    'validate.length.min',
    'validate.list',
    'validate.lines.max',
    'validate.text.quote',
    'validate.file.ext',
    'validate.name',
    'validate.lang',
    'validate.template.unknown',
    'validate.profile.missing',
    'validate.profile.invalid',
    'validate.key.typo',
  ]
  it.each(codes)('%s has a German message', (code) => {
    const msg = findingMessage({
      id: 'x',
      code,
      severity: 'error',
      line: 2,
      key: 'k',
      params: {},
      suggestion: null,
      changes: [],
      preselected: false,
    })
    expect(msg.length).toBeGreaterThan(5)
    expect(msg).not.toContain('undefined')
  })
})
